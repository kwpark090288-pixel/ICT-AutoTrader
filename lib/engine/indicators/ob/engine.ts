import type { IndicatorEngine as EngineContract } from "../../contracts";
import { listRuntimePois, replaceRuntimeObPois } from "../../runtime-poi-store";
import {
  advanceSourceEmissionState,
  type SourceEmissionState,
} from "../../source-emission";
import { getCachedTickSize } from "../../ticksize";
import type { Bar } from "../../types";
import { buildAtr14Snapshots } from "../fvg/atr";
import {
  apply15mReactionToGate as apply15mReactionToBaseGate,
  apply5mEntryToGate as apply5mEntryToBaseGate,
  buildReactionGateKey,
  createReactionGate as createBaseReactionGate,
  evaluateReactionGate,
} from "../fvg/reaction-gate";
import { evaluateStructureAtClose } from "../fvg/structure";
import { evaluateObFvgCollab } from "./collab";
import {
  evaluateObContextCollabAgainstRuntimePois,
  evaluateObContextDistanceAgainstRuntimePois,
  mergeObCollabState,
} from "./context";
import {
  OB_DETECT_TFS,
  OB_REACTION_TFS,
} from "./constants";
import { createD1PoiObCandidate, applyD1PoiObCandidateConfirm } from "./d1-poi";
import { buildObLifecycleEvents } from "./events";
import { evaluateObDisplacementAtTrigger, evaluateObSweepRecoveryAtTrigger } from "./filters";
import { createH4CoreObCandidate, applyH4CoreObCandidateConfirm } from "./h4-core";
import {
  evaluateD1PoiObInvalidationFlags,
  evaluateH4CoreObInvalidationFlags,
  evaluateObFullFillHit,
  evaluateSetupObInvalidationFlags,
  resolveObInvalidationDecision,
} from "./invalidation";
import {
  applySetupObH4OppositeChochKillChain,
  getObSetupInvalidatedDirFromH4OppositeChoch,
} from "./kill-chain";
import {
  evaluateObLtfGateFromTfBars,
  evaluateObLtfTriggers,
  isObLtfReactionTf,
  type ObLtfPoi,
  type ObLtfReactionTf,
} from "./ltf";
import {
  buildNormalizedObId,
  normalizeObZoneToTick,
} from "./normalize";
import { applyObPrune } from "./prune";
import { createSetupOb } from "./setup";
import { evaluateObZoneHeightFilter } from "./height-filter";
import { evaluateObTouchPenetrationFilter } from "./touch-filter";
import type {
  AnyObBox,
  D1PoiOb,
  Dir,
  H4CoreOb,
  ObBar,
  Pivot,
  ReactionGate,
  SetupOb,
  StructureState,
} from "./types";
import { detectObZoneCandidateFromTriggerIndex } from "./zone";

export type ObIndicatorEngine = EngineContract;

type ObContextTf = "D1" | "H4" | "H1" | "M30";

type ObContextState = {
  bars: ObBar[];
  highs: Pivot[];
  lows: Pivot[];
  structureState: StructureState;
};

type ObReactionState = {
  bars: ObBar[];
};

export interface ObRuntimeState {
  symbol: string;
  d1: ObContextState;
  h4: ObContextState;
  h1: ObContextState;
  m30: ObContextState;
  m15: ObReactionState;
  m5: ObReactionState;
  d1PoiObs: D1PoiOb[];
  h4CoreObs: H4CoreOb[];
  setupObs: SetupOb[];
  reactionGates: Map<string, ReactionGate>;
  emissionStates: Map<string, SourceEmissionState>;
}

const DETECT_BAR_BUFFER_SIZE = 512;
const REACTION_BAR_BUFFER_SIZE = 64;
const PIVOT_LEN = 3;

function isObDetectTf(tf: string): tf is ObContextTf {
  return (OB_DETECT_TFS as readonly string[]).includes(tf);
}

function createEmptyContextState(): ObContextState {
  return {
    bars: [],
    highs: [],
    lows: [],
    structureState: "MIXED",
  };
}

function createEmptyReactionState(): ObReactionState {
  return {
    bars: [],
  };
}

export function createEmptyObRuntimeState(
  symbol: string = "UNKNOWN"
): ObRuntimeState {
  return {
    symbol: symbol.toUpperCase(),
    d1: createEmptyContextState(),
    h4: createEmptyContextState(),
    h1: createEmptyContextState(),
    m30: createEmptyContextState(),
    m15: createEmptyReactionState(),
    m5: createEmptyReactionState(),
    d1PoiObs: [],
    h4CoreObs: [],
    setupObs: [],
    reactionGates: new Map(),
    emissionStates: new Map(),
  };
}

function assertSameTfAscending(bars: readonly ObBar[]) {
  if (bars.length === 0) {
    return;
  }

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("OB runtime bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("OB runtime bars must be strictly ascending by closeTime");
    }
  }
}

function appendBarKeepingRecent(
  bars: readonly ObBar[],
  nextBar: ObBar,
  maxSize: number
): ObBar[] {
  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    if (nextBar.closeTime <= last.closeTime) {
      return [...bars];
    }
  }

  const next = [...bars, nextBar];
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

function detectConfirmedObPivotAtIndex(
  bars: readonly ObBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) {
    return null;
  }

  if (bars.length === 0) {
    return null;
  }

  assertSameTfAscending(bars);

  const center = bars[pivotIndex];
  if (!center || !isObDetectTf(center.tf)) {
    return null;
  }

  const leftStart = pivotIndex - PIVOT_LEN;
  const rightEnd = pivotIndex + PIVOT_LEN;

  if (leftStart < 0 || rightEnd >= bars.length) {
    return null;
  }

  if (pivotType === "HIGH") {
    for (let i = leftStart; i <= rightEnd; i += 1) {
      if (i === pivotIndex) {
        continue;
      }

      if (center.high <= bars[i].high) {
        return null;
      }
    }

    return {
      tf: center.tf,
      pivotType: "HIGH",
      pivotTime: center.closeTime,
      pivotPrice: center.high,
      confirmedAt: bars[rightEnd].closeTime,
      isConfirmed: true,
    };
  }

  for (let i = leftStart; i <= rightEnd; i += 1) {
    if (i === pivotIndex) {
      continue;
    }

    if (center.low >= bars[i].low) {
      return null;
    }
  }

  return {
    tf: center.tf,
    pivotType: "LOW",
    pivotTime: center.closeTime,
    pivotPrice: center.low,
    confirmedAt: bars[rightEnd].closeTime,
    isConfirmed: true,
  };
}

function detectNewlyConfirmedObPivot(
  bars: readonly ObBar[],
  pivotType: "HIGH" | "LOW"
): Pivot | null {
  const pivotIndex = bars.length - 1 - PIVOT_LEN;
  if (pivotIndex < 0) {
    return null;
  }

  return detectConfirmedObPivotAtIndex(bars, pivotType, pivotIndex);
}

function getLatestPivot(
  pivots: readonly Pivot[],
  pivotType: "HIGH" | "LOW"
): Pivot | undefined {
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    if (pivots[i].pivotType === pivotType) {
      return pivots[i];
    }
  }

  return undefined;
}

function getLatestPivotPair(
  pivots: readonly Pivot[],
  pivotType: "HIGH" | "LOW"
): readonly [Pivot, Pivot] | undefined {
  const filtered = pivots.filter((pivot) => pivot.pivotType === pivotType);
  if (filtered.length < 2) {
    return undefined;
  }

  return [filtered[filtered.length - 2], filtered[filtered.length - 1]];
}

function getAtrValueAtOrBeforeTime(
  bars: readonly ObBar[],
  time: number
): number | null {
  const snapshots = buildAtr14Snapshots(bars as never);

  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    if (snapshots[i].time <= time) {
      return snapshots[i].atr14;
    }
  }

  return null;
}

function updateContextState(
  prev: ObContextState,
  bar: ObBar
): {
  next: ObContextState;
  structureEval: ReturnType<typeof evaluateStructureAtClose>;
} {
  const bars = appendBarKeepingRecent(prev.bars, bar, DETECT_BAR_BUFFER_SIZE);
  const highs = [...prev.highs];
  const lows = [...prev.lows];

  const newHigh = detectNewlyConfirmedObPivot(bars, "HIGH");
  if (newHigh) {
    highs.push(newHigh);
  }

  const newLow = detectNewlyConfirmedObPivot(bars, "LOW");
  if (newLow) {
    lows.push(newLow);
  }

  const structureEval = evaluateStructureAtClose({
    prevState: prev.structureState,
    close: bar.close,
    lastConfirmedPivotHigh: getLatestPivot(highs, "HIGH"),
    lastConfirmedPivotLow: getLatestPivot(lows, "LOW"),
  });

  return {
    next: {
      bars,
      highs,
      lows,
      structureState: structureEval.nextState,
    },
    structureEval,
  };
}

function buildCandidateDir(nextState: StructureState): Dir | null {
  if (nextState === "UP") {
    return "BULL";
  }

  if (nextState === "DOWN") {
    return "BEAR";
  }

  return null;
}

function getContextState(state: ObRuntimeState, tf: ObContextTf): ObContextState {
  if (tf === "D1") {
    return state.d1;
  }

  if (tf === "H4") {
    return state.h4;
  }

  if (tf === "H1") {
    return state.h1;
  }

  return state.m30;
}

function getPersistentObTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => !tag.startsWith("COLLAB_"));
}

function updateObTouchFields<T extends D1PoiOb | H4CoreOb | SetupOb>(
  box: T,
  bar: ObBar,
  atrAtBar: number
): T {
  const touchEval = evaluateObTouchPenetrationFilter({
    wickHigh: bar.high,
    wickLow: bar.low,
    top: box.zone.top,
    bottom: box.zone.bottom,
    atrForTf: atrAtBar,
  });

  const touched = Boolean(touchEval?.passTouchPenetration);
  const fullFillHit =
    box.fullFillHit ||
    evaluateObFullFillHit({
      dir: box.dir,
      zone: box.zone,
      wickHigh: bar.high,
      wickLow: bar.low,
    });

  return {
    ...box,
    touchCount: touched ? box.touchCount + 1 : box.touchCount,
    ...(touched ? { lastTouchTime: bar.closeTime } : {}),
    fullFillHit,
    ...(fullFillHit && !box.fullFillTime ? { fullFillTime: bar.closeTime } : {}),
  };
}

function detectD1PoiOb(
  state: ObRuntimeState,
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  runtimePois: ReturnType<typeof listRuntimePois>,
  tickSize: number
): void {
  if (!structureEval.breakType) {
    return;
  }

  const currentBar = state.d1.bars[state.d1.bars.length - 1];
  const dir = buildCandidateDir(structureEval.nextState);
  const atrAtTrigger = getAtrValueAtOrBeforeTime(state.d1.bars, currentBar.closeTime);

  if (!currentBar || !dir || !Number.isFinite(atrAtTrigger)) {
    return;
  }

  const triggerIndex = state.d1.bars.length - 1;
  const zoneCandidate = detectObZoneCandidateFromTriggerIndex(
    state.d1.bars,
    dir,
    triggerIndex
  );

  const heightFilterEval = zoneCandidate
    ? evaluateObZoneHeightFilter({
        tf: "D1",
        zoneHeight: zoneCandidate.zone.height,
        atrAtTrigger: atrAtTrigger as number,
      })
    : null;

  const displacementEval = evaluateObDisplacementAtTrigger({
    tfBars: state.d1.bars,
    triggerIndex,
    atrAtTrigger: atrAtTrigger as number,
  });

  const contextEval = zoneCandidate
    ? evaluateObContextDistanceAgainstRuntimePois({
        symbol: state.symbol,
        dir,
        zone: zoneCandidate.zone,
        atrAtEval: atrAtTrigger as number,
        tEval: currentBar.closeTime,
        runtimePois,
      })
    : null;

  const normalizedZone = zoneCandidate
    ? normalizeObZoneToTick({
        bottom: zoneCandidate.zone.bottom,
        top: zoneCandidate.zone.top,
        tick: tickSize,
      })
    : null;

  if (!zoneCandidate || !normalizedZone) {
    return;
  }

  const candidateId = buildNormalizedObId({
    symbol: state.symbol,
    type: "D1_POI_OB",
    tf: "D1",
    triggerTime: zoneCandidate.triggerTime,
    dir,
    zone: normalizedZone,
  });

  if (state.d1PoiObs.some((box) => box.id === candidateId)) {
    return;
  }

  const candidate = createD1PoiObCandidate({
    id: candidateId,
    symbol: state.symbol,
    zoneCandidate,
    heightFilterEval,
    structureTriggered: Boolean(structureEval.breakType),
    displacementEval,
    contextEval,
  });

  if (candidate) {
    state.d1PoiObs = [...state.d1PoiObs, candidate];
  }
}

function detectH4CoreOb(
  state: ObRuntimeState,
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  runtimePois: ReturnType<typeof listRuntimePois>,
  tickSize: number
): void {
  if (!structureEval.breakType) {
    return;
  }

  const currentBar = state.h4.bars[state.h4.bars.length - 1];
  const dir = buildCandidateDir(structureEval.nextState);
  const atrAtTrigger = getAtrValueAtOrBeforeTime(state.h4.bars, currentBar.closeTime);

  if (!currentBar || !dir || !Number.isFinite(atrAtTrigger)) {
    return;
  }

  const triggerIndex = state.h4.bars.length - 1;
  const zoneCandidate = detectObZoneCandidateFromTriggerIndex(
    state.h4.bars,
    dir,
    triggerIndex
  );

  const heightFilterEval = zoneCandidate
    ? evaluateObZoneHeightFilter({
        tf: "H4",
        zoneHeight: zoneCandidate.zone.height,
        atrAtTrigger: atrAtTrigger as number,
      })
    : null;

  const displacementEval = evaluateObDisplacementAtTrigger({
    tfBars: state.h4.bars,
    triggerIndex,
    atrAtTrigger: atrAtTrigger as number,
  });

  const contextEval = zoneCandidate
    ? evaluateObContextDistanceAgainstRuntimePois({
        symbol: state.symbol,
        dir,
        zone: zoneCandidate.zone,
        atrAtEval: atrAtTrigger as number,
        tEval: currentBar.closeTime,
        runtimePois,
      })
    : null;

  const normalizedZone = zoneCandidate
    ? normalizeObZoneToTick({
        bottom: zoneCandidate.zone.bottom,
        top: zoneCandidate.zone.top,
        tick: tickSize,
      })
    : null;

  if (!zoneCandidate || !normalizedZone) {
    return;
  }

  const candidateId = buildNormalizedObId({
    symbol: state.symbol,
    type: "H4_CORE_OB",
    tf: "H4",
    triggerTime: zoneCandidate.triggerTime,
    dir,
    zone: normalizedZone,
  });

  if (state.h4CoreObs.some((box) => box.id === candidateId)) {
    return;
  }

  const candidate = createH4CoreObCandidate({
    id: candidateId,
    symbol: state.symbol,
    zoneCandidate,
    heightFilterEval,
    structureTriggered: Boolean(structureEval.breakType),
    displacementEval,
    contextEval,
  });

  if (candidate) {
    state.h4CoreObs = [...state.h4CoreObs, candidate];
  }
}

function detectSetupOb(
  state: ObRuntimeState,
  tf: "H1" | "M30",
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  runtimePois: ReturnType<typeof listRuntimePois>,
  tickSize: number
): void {
  if (!structureEval.breakType) {
    return;
  }

  const contextState = tf === "H1" ? state.h1 : state.m30;
  const currentBar = contextState.bars[contextState.bars.length - 1];
  const dir = buildCandidateDir(structureEval.nextState);
  const atrAtTrigger = getAtrValueAtOrBeforeTime(
    contextState.bars,
    currentBar.closeTime
  );

  if (!currentBar || !dir || !Number.isFinite(atrAtTrigger)) {
    return;
  }

  const triggerIndex = contextState.bars.length - 1;
  const zoneCandidate = detectObZoneCandidateFromTriggerIndex(
    contextState.bars,
    dir,
    triggerIndex
  );

  const heightFilterEval = zoneCandidate
    ? evaluateObZoneHeightFilter({
        tf,
        zoneHeight: zoneCandidate.zone.height,
        atrAtTrigger: atrAtTrigger as number,
      })
    : null;

  const displacementEval = evaluateObDisplacementAtTrigger({
    tfBars: contextState.bars,
    triggerIndex,
    atrAtTrigger: atrAtTrigger as number,
  });

  const sweepRecoveryEval = evaluateObSweepRecoveryAtTrigger({
    tfBars: contextState.bars,
    triggerIndex,
    dir,
    atrAtTrigger: atrAtTrigger as number,
    eqPivotPair:
      dir === "BULL"
        ? getLatestPivotPair(contextState.lows, "LOW")
        : getLatestPivotPair(contextState.highs, "HIGH"),
    lastConfirmedPivotHigh: getLatestPivot(contextState.highs, "HIGH"),
    lastConfirmedPivotLow: getLatestPivot(contextState.lows, "LOW"),
  });

  const contextEval = zoneCandidate
    ? evaluateObContextDistanceAgainstRuntimePois({
        symbol: state.symbol,
        dir,
        zone: zoneCandidate.zone,
        atrAtEval: atrAtTrigger as number,
        tEval: currentBar.closeTime,
        runtimePois,
      })
    : null;

  const normalizedZone = zoneCandidate
    ? normalizeObZoneToTick({
        bottom: zoneCandidate.zone.bottom,
        top: zoneCandidate.zone.top,
        tick: tickSize,
      })
    : null;

  if (!zoneCandidate || !normalizedZone) {
    return;
  }

  const setupId = buildNormalizedObId({
    symbol: state.symbol,
    type: "SETUP_OB",
    tf,
    triggerTime: zoneCandidate.triggerTime,
    dir,
    zone: normalizedZone,
  });

  if (state.setupObs.some((box) => box.id === setupId)) {
    return;
  }

  const setup = createSetupOb({
    id: setupId,
    symbol: state.symbol,
    zoneCandidate,
    heightFilterEval,
    structureTriggered: Boolean(structureEval.breakType),
    displacementEval,
    sweepRecoveryEval,
    contextEval,
    h4StructureAtConf: state.h4.structureState,
    d1PoiObs: state.d1PoiObs.filter((box) => box.state === "ACTIVE"),
    h4CoreObs: state.h4CoreObs.filter((box) => box.state === "POI_ACTIVE"),
  });

  if (setup) {
    state.setupObs = [...state.setupObs, setup];
  }
}

function updateD1PoiObsOnBar(
  state: ObRuntimeState,
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  bar: ObBar
): void {
  const atrAtBar = getAtrValueAtOrBeforeTime(state.d1.bars, bar.closeTime);
  const latestEqHighPair = getLatestPivotPair(state.d1.highs, "HIGH");
  const latestEqLowPair = getLatestPivotPair(state.d1.lows, "LOW");
  const lastConfirmedPivotHigh = getLatestPivot(state.d1.highs, "HIGH");
  const lastConfirmedPivotLow = getLatestPivot(state.d1.lows, "LOW");

  state.d1PoiObs = state.d1PoiObs.map((box) => {
    if (box.state === "CANDIDATE") {
      const next = applyD1PoiObCandidateConfirm({
        candidate: box,
        currentCloseTime: bar.closeTime,
        sweepRecoveryEval:
          bar.closeTime === box.confirmDueTime && Number.isFinite(atrAtBar)
            ? evaluateObSweepRecoveryAtTrigger({
                tfBars: state.d1.bars,
                triggerIndex: state.d1.bars.length - 1,
                dir: box.dir,
                atrAtTrigger: atrAtBar as number,
                eqPivotPair:
                  box.dir === "BULL" ? latestEqLowPair : latestEqHighPair,
                lastConfirmedPivotHigh,
                lastConfirmedPivotLow,
              })
            : null,
      });

      return next;
    }

    if (box.state !== "ACTIVE") {
      return box;
    }

    const withFields =
      Number.isFinite(atrAtBar) && (atrAtBar as number) > 0
        ? updateObTouchFields(box, bar, atrAtBar as number)
        : box;

    const decision = resolveObInvalidationDecision(
      evaluateD1PoiObInvalidationFlags({
        fullFillHit: withFields.fullFillHit,
        oppositeChoch:
          structureEval.breakType === "CHOCH" &&
          ((box.dir === "BULL" && structureEval.nextState === "DOWN") ||
            (box.dir === "BEAR" && structureEval.nextState === "UP")),
      })
    );

    return decision.invalidated
      ? {
          ...withFields,
          state: "INACTIVE",
          invalidReason: decision.invalidReason ?? undefined,
          endTime: bar.closeTime,
        }
      : withFields;
  });
}

function updateH4CoreObsOnBar(
  state: ObRuntimeState,
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  bar: ObBar
): void {
  const atrAtBar = getAtrValueAtOrBeforeTime(state.h4.bars, bar.closeTime);
  const latestEqHighPair = getLatestPivotPair(state.h4.highs, "HIGH");
  const latestEqLowPair = getLatestPivotPair(state.h4.lows, "LOW");
  const lastConfirmedPivotHigh = getLatestPivot(state.h4.highs, "HIGH");
  const lastConfirmedPivotLow = getLatestPivot(state.h4.lows, "LOW");

  state.h4CoreObs = state.h4CoreObs.map((box) => {
    if (box.state === "CANDIDATE") {
      return applyH4CoreObCandidateConfirm({
        candidate: box,
        currentCloseTime: bar.closeTime,
        sweepRecoveryEval:
          bar.closeTime === box.confirmDueTime && Number.isFinite(atrAtBar)
            ? evaluateObSweepRecoveryAtTrigger({
                tfBars: state.h4.bars,
                triggerIndex: state.h4.bars.length - 1,
                dir: box.dir,
                atrAtTrigger: atrAtBar as number,
                eqPivotPair:
                  box.dir === "BULL" ? latestEqLowPair : latestEqHighPair,
                lastConfirmedPivotHigh,
                lastConfirmedPivotLow,
              })
            : null,
      });
    }

    if (box.state !== "POI_ACTIVE") {
      return box;
    }

    const withFields =
      Number.isFinite(atrAtBar) && (atrAtBar as number) > 0
        ? updateObTouchFields(box, bar, atrAtBar as number)
        : box;

    const decision = resolveObInvalidationDecision(
      evaluateH4CoreObInvalidationFlags({
        fullFillHit: withFields.fullFillHit,
        oppositeChoch:
          structureEval.breakType === "CHOCH" &&
          ((box.dir === "BULL" && structureEval.nextState === "DOWN") ||
            (box.dir === "BEAR" && structureEval.nextState === "UP")),
        touchCount: withFields.touchCount,
      })
    );

    return decision.invalidated
      ? {
          ...withFields,
          state: "INACTIVE",
          invalidReason: decision.invalidReason ?? undefined,
          endTime: bar.closeTime,
        }
      : withFields;
  });
}

function updateSetupObsOnOwnBar(
  state: ObRuntimeState,
  tf: "H1" | "M30",
  structureEval: ReturnType<typeof evaluateStructureAtClose>,
  bar: ObBar
): void {
  const contextState = tf === "H1" ? state.h1 : state.m30;
  const atrAtBar = getAtrValueAtOrBeforeTime(contextState.bars, bar.closeTime);

  state.setupObs = state.setupObs.map((box) => {
    if (box.state !== "ACTIVE" || box.tf !== tf) {
      return box;
    }

    const withFields =
      Number.isFinite(atrAtBar) && (atrAtBar as number) > 0
        ? updateObTouchFields(box, bar, atrAtBar as number)
        : box;

    const decision = resolveObInvalidationDecision(
      evaluateSetupObInvalidationFlags({
        fullFillHit: withFields.fullFillHit,
        localOppositeChoch:
          structureEval.breakType === "CHOCH" &&
          ((box.dir === "BULL" && structureEval.nextState === "DOWN") ||
            (box.dir === "BEAR" && structureEval.nextState === "UP")),
        touchCount: withFields.touchCount,
        localOppChochAfterTouchOnly: withFields.localOppChochAfterTouchOnly,
      })
    );

    return decision.invalidated
      ? {
          ...withFields,
          state: "INACTIVE",
          invalidReason: decision.invalidReason ?? undefined,
          endTime: bar.closeTime,
        }
      : withFields;
  });
}

function refreshObCollabState(
  state: ObRuntimeState,
  currentCloseTime: number
): void {
  const runtimePois = listRuntimePois(state.symbol);
  const runtimeFvgs = runtimePois.filter(
    (poi): poi is Extract<(typeof runtimePois)[number], { kind: "FVG" }> =>
      poi.kind === "FVG"
  );

  const refreshOne = <T extends D1PoiOb | H4CoreOb | SetupOb>(box: T): T => {
    if (
      (box.type === "D1_POI_OB" && box.state !== "ACTIVE") ||
      (box.type === "H4_CORE_OB" && box.state !== "POI_ACTIVE") ||
      (box.type === "SETUP_OB" && box.state !== "ACTIVE")
    ) {
      return box;
    }

    const atrAtEval = getAtrValueAtOrBeforeTime(
      getContextState(state, box.tf as ObContextTf).bars,
      currentCloseTime
    );

    const fvgCollab = evaluateObFvgCollab(box, runtimeFvgs);
    const contextCollab =
      Number.isFinite(atrAtEval) && (atrAtEval as number) > 0
        ? evaluateObContextCollabAgainstRuntimePois({
            symbol: state.symbol,
            dir: box.dir,
            zone: box.zone,
            atrAtEval: atrAtEval as number,
            tEval: currentCloseTime,
            runtimePois,
          })
        : { tags: [] as string[] };

    const merged = mergeObCollabState({
      baseTags: getPersistentObTags(box.tags),
      fvgTags: fvgCollab.tags,
      fvgBestCollab: fvgCollab.bestCollab,
      contextTags: contextCollab.tags,
      contextBestCollab: contextCollab.bestCollab,
    });

    return {
      ...box,
      tags: merged.tags,
      bestCollab: merged.bestCollab,
    };
  };

  state.d1PoiObs = state.d1PoiObs.map(refreshOne);
  state.h4CoreObs = state.h4CoreObs.map(refreshOne);
  state.setupObs = state.setupObs.map(refreshOne);
}

function refreshRuntimeObPois(state: ObRuntimeState): void {
  replaceRuntimeObPois(state.symbol, [
    ...state.d1PoiObs,
    ...state.h4CoreObs,
    ...state.setupObs,
  ]);
}

function getActiveReactionPois(state: ObRuntimeState): ObLtfPoi[] {
  return [
    ...state.d1PoiObs.filter((box) => box.state === "ACTIVE"),
    ...state.h4CoreObs.filter((box) => box.state === "POI_ACTIVE"),
    ...state.setupObs.filter((box) => box.state === "ACTIVE"),
  ];
}

function createObReactionGate(symbol: string, poiId: string, dir: Dir): ReactionGate {
  return {
    ...createBaseReactionGate(symbol, poiId, dir),
    symbol,
    poiId,
    dir,
  };
}

function apply15mReactionToObGate(
  gate: ReactionGate,
  reactionTime: number
): ReactionGate {
  return {
    ...gate,
    ...apply15mReactionToBaseGate(gate, reactionTime),
  };
}

function apply5mEntryToObGate(
  gate: ReactionGate,
  entryTime: number
): ReactionGate {
  return {
    ...gate,
    ...apply5mEntryToBaseGate(gate, entryTime),
  };
}

function evaluateReactionLayer(
  state: ObRuntimeState,
  tf: ObLtfReactionTf,
  bar: ObBar
): string[] {
  const reactionState = tf === "M15" ? state.m15 : state.m5;
  reactionState.bars = appendBarKeepingRecent(
    reactionState.bars,
    bar,
    REACTION_BAR_BUFFER_SIZE
  );

  const activePois = getActiveReactionPois(state);
  const activeIds = new Set(activePois.map((poi) => poi.id));
  const out: string[] = [];

  for (const poi of activePois) {
    const emissionKey = `${poi.id}|${tf}`;
    const gateKey = buildReactionGateKey(state.symbol, poi.id, poi.dir);
    const gate =
      state.reactionGates.get(gateKey) ??
      createObReactionGate(state.symbol, poi.id, poi.dir);
    const gateEval = evaluateObLtfGateFromTfBars(reactionState.bars, poi);
    const triggerEval = evaluateObLtfTriggers(reactionState.bars, poi);
    const cooldownEval = evaluateReactionGate(gate, tf, bar.closeTime);

    const transition = advanceSourceEmissionState({
      prev: state.emissionStates.get(emissionKey),
      ltf: tf,
      closeTime: bar.closeTime,
      poiId: poi.id,
      gatePass: Boolean(gateEval?.passGate) && !cooldownEval.reactionBlocked,
      currentTriggers:
        gateEval?.passGate && !cooldownEval.reactionBlocked
          ? triggerEval?.tokens ?? []
          : [],
    });

    state.emissionStates.set(emissionKey, transition.next);

    let nextGate = gate;
    if (transition.event) {
      out.push(transition.event);

      if (tf === "M15") {
        nextGate = apply15mReactionToObGate(nextGate, bar.closeTime);
      } else if (transition.currStage === "ENTRY_WINDOW_OPEN") {
        nextGate = apply5mEntryToObGate(nextGate, bar.closeTime);
      }
    }

    state.reactionGates.set(gateKey, nextGate);
  }

  for (const key of [...state.emissionStates.keys()]) {
    const [poiId] = key.split("|");
    if (!activeIds.has(poiId)) {
      state.emissionStates.delete(key);
    }
  }

  for (const key of [...state.reactionGates.keys()]) {
    const parts = key.split(":");
    const poiId = parts.length >= 2 ? parts[1] : "";
    if (!activeIds.has(poiId)) {
      state.reactionGates.delete(key);
    }
  }

  return out;
}

function splitObBoxes(boxes: readonly AnyObBox[]): {
  d1PoiObs: D1PoiOb[];
  h4CoreObs: H4CoreOb[];
  setupObs: SetupOb[];
} {
  const d1PoiObs: D1PoiOb[] = [];
  const h4CoreObs: H4CoreOb[] = [];
  const setupObs: SetupOb[] = [];

  for (const box of boxes) {
    if (box.type === "D1_POI_OB") {
      d1PoiObs.push(box);
    } else if (box.type === "H4_CORE_OB") {
      h4CoreObs.push(box);
    } else {
      setupObs.push(box);
    }
  }

  return { d1PoiObs, h4CoreObs, setupObs };
}

export function applyObBarClose(
  prevState: ObRuntimeState,
  bar: Bar,
  options: {
    publishRuntime?: boolean;
    refreshCrossSourceCollab?: boolean;
  } = {}
): { nextState: ObRuntimeState; events: string[] } {
  const state: ObRuntimeState = {
    ...prevState,
    d1: {
      ...prevState.d1,
      bars: [...prevState.d1.bars],
      highs: [...prevState.d1.highs],
      lows: [...prevState.d1.lows],
    },
    h4: {
      ...prevState.h4,
      bars: [...prevState.h4.bars],
      highs: [...prevState.h4.highs],
      lows: [...prevState.h4.lows],
    },
    h1: {
      ...prevState.h1,
      bars: [...prevState.h1.bars],
      highs: [...prevState.h1.highs],
      lows: [...prevState.h1.lows],
    },
    m30: {
      ...prevState.m30,
      bars: [...prevState.m30.bars],
      highs: [...prevState.m30.highs],
      lows: [...prevState.m30.lows],
    },
    m15: { bars: [...prevState.m15.bars] },
    m5: { bars: [...prevState.m5.bars] },
    d1PoiObs: [...prevState.d1PoiObs],
    h4CoreObs: [...prevState.h4CoreObs],
    setupObs: [...prevState.setupObs],
    reactionGates: new Map(prevState.reactionGates),
    emissionStates: new Map(prevState.emissionStates),
  };
  const obBar = bar as ObBar;
  const events: string[] = [];

  if (isObLtfReactionTf(bar.tf)) {
    events.push(...evaluateReactionLayer(state, bar.tf, obBar));
    if (options.publishRuntime !== false) {
      refreshRuntimeObPois(state);
    }
    return { nextState: state, events };
  }

  if (!isObDetectTf(bar.tf)) {
    if (options.publishRuntime !== false) {
      refreshRuntimeObPois(state);
    }
    return { nextState: state, events };
  }

  const tickSize = getCachedTickSize(state.symbol);
  const runtimePois = listRuntimePois(state.symbol);

  if (bar.tf === "D1") {
    const { next, structureEval } = updateContextState(state.d1, obBar);
    state.d1 = next;

    if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
      detectD1PoiOb(state, structureEval, runtimePois, tickSize as number);
    }

    updateD1PoiObsOnBar(state, structureEval, obBar);
  } else if (bar.tf === "H4") {
    const { next, structureEval } = updateContextState(state.h4, obBar);
    state.h4 = next;

    if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
      detectH4CoreOb(state, structureEval, runtimePois, tickSize as number);
    }

    updateH4CoreObsOnBar(state, structureEval, obBar);

    const invalidatedDir = getObSetupInvalidatedDirFromH4OppositeChoch(
      structureEval.breakType,
      structureEval.nextState as StructureState
    );
    state.setupObs = state.setupObs.map((setup) =>
      applySetupObH4OppositeChochKillChain({
        setup,
        invalidatedDir,
        currentCloseTime: bar.closeTime,
      })
    );
  } else if (bar.tf === "H1" || bar.tf === "M30") {
    const current = bar.tf === "H1" ? state.h1 : state.m30;
    const { next, structureEval } = updateContextState(current, obBar);

    if (bar.tf === "H1") {
      state.h1 = next;
    } else {
      state.m30 = next;
    }

    updateSetupObsOnOwnBar(state, bar.tf, structureEval, obBar);

    if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
      detectSetupOb(state, bar.tf, structureEval, runtimePois, tickSize as number);
    }
  }

  const pruned = applyObPrune(
    [...state.d1PoiObs, ...state.h4CoreObs, ...state.setupObs],
    bar.closeTime
  );
  const split = splitObBoxes(pruned);
  state.d1PoiObs = split.d1PoiObs;
  state.h4CoreObs = split.h4CoreObs;
  state.setupObs = split.setupObs;

  if (options.refreshCrossSourceCollab !== false) {
    refreshObCollabState(state, bar.closeTime);
  }

  events.push(
    ...buildObLifecycleEvents({
      prevD1Pois: prevState.d1PoiObs,
      nextD1Pois: state.d1PoiObs,
      prevH4CoreObs: prevState.h4CoreObs,
      nextH4CoreObs: state.h4CoreObs,
      prevSetupObs: prevState.setupObs,
      nextSetupObs: state.setupObs,
      currentCloseTime: bar.closeTime,
      tickSize: Number.isFinite(tickSize) ? (tickSize as number) : null,
    })
  );

  if (options.publishRuntime !== false) {
    refreshRuntimeObPois(state);
  }
  return { nextState: state, events };
}

export function applyObCrossSourcePhase(
  prevState: ObRuntimeState,
  currentCloseTime: number
): { nextState: ObRuntimeState; events: string[] } {
  const state: ObRuntimeState = {
    ...prevState,
    d1: {
      ...prevState.d1,
      bars: [...prevState.d1.bars],
      highs: [...prevState.d1.highs],
      lows: [...prevState.d1.lows],
    },
    h4: {
      ...prevState.h4,
      bars: [...prevState.h4.bars],
      highs: [...prevState.h4.highs],
      lows: [...prevState.h4.lows],
    },
    h1: {
      ...prevState.h1,
      bars: [...prevState.h1.bars],
      highs: [...prevState.h1.highs],
      lows: [...prevState.h1.lows],
    },
    m30: {
      ...prevState.m30,
      bars: [...prevState.m30.bars],
      highs: [...prevState.m30.highs],
      lows: [...prevState.m30.lows],
    },
    m15: { bars: [...prevState.m15.bars] },
    m5: { bars: [...prevState.m5.bars] },
    d1PoiObs: [...prevState.d1PoiObs],
    h4CoreObs: [...prevState.h4CoreObs],
    setupObs: [...prevState.setupObs],
    reactionGates: new Map(prevState.reactionGates),
    emissionStates: new Map(prevState.emissionStates),
  };

  refreshObCollabState(state, currentCloseTime);

  return {
    nextState: state,
    events: [],
  };
}

export function createObIndicatorEngine(
  symbol: string = "UNKNOWN"
): ObIndicatorEngine {
  let state = createEmptyObRuntimeState(symbol);

  return {
    onBarClose(bar: Bar): string[] {
      const result = applyObBarClose(state, bar);
      state = result.nextState;
      return result.events;
    },
    onBarClosePhaseA(bar: Bar): string[] {
      const result = applyObBarClose(state, bar, {
        publishRuntime: false,
        refreshCrossSourceCollab: false,
      });
      state = result.nextState;
      return result.events;
    },
    onBarClosePhaseC(bar: Bar): string[] {
      const result = applyObCrossSourcePhase(state, bar.closeTime);
      state = result.nextState;
      return result.events;
    },
    publishRuntimeSnapshot(): void {
      refreshRuntimeObPois(state);
    },
  };
}
