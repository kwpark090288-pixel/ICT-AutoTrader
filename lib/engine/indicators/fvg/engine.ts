import { buildStackId } from "../../id";
import {
  advanceSourceEmissionState,
  type SourceEmissionState,
} from "../../source-emission";
import { listRuntimePois, replaceRuntimeFvgPois } from "../../runtime-poi-store";
import { getCachedTickSize } from "../../ticksize";
import type { IndicatorEngine as EngineContract } from "../../contracts";
import type { Bar } from "../../types";
import { getAtrValueAtConfTime } from "./atr";
import {
  FVG_ATR_PERIOD,
  FVG_CONTEXT_TFS,
  FVG_DETECT_TFS,
  FVG_REACTION_TFS,
  MIN_ZONE_HEIGHT_ATR,
} from "./constants";
import { evaluateF4Context } from "./context";
import {
  evaluateD1MixedStrongDisplacementFromRecentBars,
  evaluateD1PoiFvgInvalidationFlags,
  evaluateD1PoiFvgRegistration,
} from "./d1-poi";
import { evaluateDisplacementF1FromTfBars } from "./displacement";
import {
  buildFvgLifecycleEvents,
  formatH4CoreFvgCandidateNewEvent,
} from "./events";
import { applyH4CoreFvgCandidateConfirm } from "./h4-confirm";
import {
  createH4CoreFvgCandidate,
  type getH4CoreConfirmDueTime,
} from "./h4-core";
import {
  evaluateH4CoreFvgPassF2,
  evaluateH4CoreFvgPassF3,
  type H4StructureBreakSnapshot,
} from "./h4-secondary";
import {
  evaluateFvgFullFillHit,
  evaluateH4CoreFvgInvalidationFlags,
  evaluateSetupFvgInvalidationFlags,
  resolveFvgInvalidationDecision,
} from "./invalidation";
import {
  applySetupFvgOppositeChochKillChain,
  listKilledH4CoreFvgsAtCloseTime,
} from "./kill-chain";
import {
  evaluateLtfGateFromTfBars,
  type LtfGatePoi,
  isLtfReactionTf,
} from "./ltf-gate";
import { evaluateLtfTriggers } from "./ltf-triggers";
import {
  buildNormalizedFvgId,
  normalizeFvgZoneToTick,
} from "./normalize";
import {
  detectConfirmedFractalPivotAtIndex,
  detectNewlyConfirmedFractalPivot,
  isPivotStructureTf,
} from "./pivots";
import { applyFvgPrune } from "./prune";
import {
  apply15mReactionToGate,
  apply5mEntryToGate,
  buildReactionGateKey,
  createReactionGate,
  evaluateReactionGate,
} from "./reaction-gate";
import {
  createSetupFvgFromParentPool,
  isSetupTf,
  type SetupParentPoi,
} from "./setup";
import { createStackZonesInPriorityOrder } from "./stack";
import { evaluateStructureAtClose } from "./structure";
import { evaluateTouchPenetrationFilter } from "./touch-filter";
import type {
  AnyFvgBox,
  D1PoiFvg,
  DetectedWickFvg,
  Dir,
  DisplacementEvalResult,
  FvgBar,
  FvgTf,
  H4CoreFvg,
  Pivot,
  ReactionGate,
  SetupFvg,
  StackZone,
  StructureEvalResult,
  StructureState,
} from "./types";

export type FvgIndicatorEngine = EngineContract;

type FvgReactionTf = (typeof FVG_REACTION_TFS)[number];
type FvgContextTf = (typeof FVG_CONTEXT_TFS)[number];

type FvgContextState = {
  bars: FvgBar[];
  highs: Pivot[];
  lows: Pivot[];
  structureState: StructureState;
  structureBreaks: H4StructureBreakSnapshot[];
};

type FvgReactionState = {
  bars: FvgBar[];
};

const DETECT_BAR_BUFFER_SIZE = 512;
const REACTION_BAR_BUFFER_SIZE = 64;

export interface FvgRuntimeState {
  symbol: string;
  d1: FvgContextState;
  h4: FvgContextState;
  h1Bars: FvgBar[];
  m30Bars: FvgBar[];
  m15: FvgReactionState;
  m5: FvgReactionState;
  d1Pois: D1PoiFvg[];
  h4CoreFvgs: H4CoreFvg[];
  setupFvgs: SetupFvg[];
  stackZones: StackZone[];
  reactionGates: Map<string, ReactionGate>;
  emissionStates: Map<string, SourceEmissionState>;
}

function createEmptyContextState(): FvgContextState {
  return {
    bars: [],
    highs: [],
    lows: [],
    structureState: "MIXED",
    structureBreaks: [],
  };
}

function createEmptyReactionState(): FvgReactionState {
  return {
    bars: [],
  };
}

export function createEmptyFvgRuntimeState(
  symbol: string = "UNKNOWN"
): FvgRuntimeState {
  return {
    symbol: symbol.toUpperCase(),
    d1: createEmptyContextState(),
    h4: createEmptyContextState(),
    h1Bars: [],
    m30Bars: [],
    m15: createEmptyReactionState(),
    m5: createEmptyReactionState(),
    d1Pois: [],
    h4CoreFvgs: [],
    setupFvgs: [],
    stackZones: [],
    reactionGates: new Map(),
    emissionStates: new Map(),
  };
}

export function isFvgDetectTf(tf: string): tf is FvgTf {
  return (FVG_DETECT_TFS as readonly string[]).includes(tf);
}

function appendBarKeepingRecent(
  bars: readonly FvgBar[],
  nextBar: FvgBar,
  maxSize: number
): FvgBar[] {
  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    if (nextBar.closeTime <= last.closeTime) {
      return [...bars];
    }
  }

  const next = [...bars, nextBar];
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

function buildDetectedWickFvg(args: {
  tf: FvgTf;
  dir: Dir;
  left: FvgBar;
  middle: FvgBar;
  right: FvgBar;
  atrAtConf: number;
  bottom: number;
  top: number;
}): DetectedWickFvg | null {
  const { tf, dir, left, middle, right, atrAtConf, bottom, top } = args;
  const height = top - bottom;

  if (height < atrAtConf * MIN_ZONE_HEIGHT_ATR) {
    return null;
  }

  return {
    tf,
    dir,
    leftCloseTime: left.closeTime,
    middleCloseTime: middle.closeTime,
    rightCloseTime: right.closeTime,
    confTime: right.closeTime,
    atrAtConf,
    zone: {
      bottom,
      top,
      height,
    },
  };
}

export function detectConfirmedWickFvgFromRecentBars(
  recentBars: readonly FvgBar[],
  atrAtConf: number
): DetectedWickFvg | null {
  if (recentBars.length < 3) return null;
  if (!Number.isFinite(atrAtConf) || atrAtConf <= 0) return null;

  const [left, middle, right] = recentBars.slice(recentBars.length - 3);

  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!isFvgDetectTf(right.tf)) return null;

  if (!(left.closeTime < middle.closeTime && middle.closeTime < right.closeTime)) {
    return null;
  }

  if (left.high < right.low) {
    return buildDetectedWickFvg({
      tf: right.tf as FvgTf,
      dir: "BULL",
      left,
      middle,
      right,
      atrAtConf,
      bottom: left.high,
      top: right.low,
    });
  }

  if (left.low > right.high) {
    return buildDetectedWickFvg({
      tf: right.tf as FvgTf,
      dir: "BEAR",
      left,
      middle,
      right,
      atrAtConf,
      bottom: right.high,
      top: left.low,
    });
  }

  return null;
}

export function detectConfirmedWickFvgWithAtrFromTfBars(
  tfBars: readonly FvgBar[]
): DetectedWickFvg | null {
  if (tfBars.length < FVG_ATR_PERIOD) return null;
  if (tfBars.length < 3) return null;

  const recentBars = tfBars.slice(tfBars.length - 3);
  const confTime = recentBars[2].closeTime;
  const atrAtConf = getAtrValueAtConfTime(tfBars, confTime);

  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  return detectConfirmedWickFvgFromRecentBars(recentBars, atrAtConf as number);
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

function updateContextState(
  prev: FvgContextState,
  bar: FvgBar
): { next: FvgContextState; structureEval: StructureEvalResult } {
  const bars = appendBarKeepingRecent(prev.bars, bar, DETECT_BAR_BUFFER_SIZE);
  const highs = [...prev.highs];
  const lows = [...prev.lows];

  const newHigh = detectNewlyConfirmedFractalPivot(bars, "HIGH");
  if (newHigh) {
    highs.push(newHigh);
  }

  const newLow = detectNewlyConfirmedFractalPivot(bars, "LOW");
  if (newLow) {
    lows.push(newLow);
  }

  const structureEval = evaluateStructureAtClose({
    prevState: prev.structureState,
    close: bar.close,
    lastConfirmedPivotHigh: getLatestPivot(highs, "HIGH"),
    lastConfirmedPivotLow: getLatestPivot(lows, "LOW"),
  });

  const structureBreaks =
    structureEval.breakType && bar.tf === "H4"
      ? [
          ...prev.structureBreaks,
          {
            tf: "H4" as const,
            closeTime: bar.closeTime,
            nextState: structureEval.nextState,
            breakType: structureEval.breakType,
          },
        ]
      : prev.structureBreaks;

  return {
    next: {
      bars,
      highs,
      lows,
      structureState: structureEval.nextState,
      structureBreaks,
    },
    structureEval,
  };
}

function normalizeDetectedFvgToTick(
  detectedFvg: DetectedWickFvg | null,
  tickSize: number
): DetectedWickFvg | null {
  if (!detectedFvg) {
    return null;
  }

  const normalizedZone = normalizeFvgZoneToTick({
    bottom: detectedFvg.zone.bottom,
    top: detectedFvg.zone.top,
    tick: tickSize,
  });

  if (!normalizedZone) {
    return null;
  }

  return {
    ...detectedFvg,
    zone: {
      bottom: normalizedZone.bottomNorm,
      top: normalizedZone.topNorm,
      height: normalizedZone.topNorm - normalizedZone.bottomNorm,
    },
  };
}

function buildD1PoiFvgFromDetected(args: {
  symbol: string;
  detectedFvg: DetectedWickFvg;
  structureAtConf: StructureState;
  passDisplacement: boolean;
  passMixedStrongDisp: boolean;
  tickSize: number;
}): D1PoiFvg | null {
  const { symbol, detectedFvg, structureAtConf, passDisplacement, passMixedStrongDisp, tickSize } = args;
  const normalizedZone = normalizeFvgZoneToTick({
    bottom: detectedFvg.zone.bottom,
    top: detectedFvg.zone.top,
    tick: tickSize,
  });

  if (!normalizedZone) {
    return null;
  }

  return {
    id: buildNormalizedFvgId({
      symbol,
      type: "D1_POI_FVG",
      tf: "D1",
      confTime: detectedFvg.confTime,
      dir: detectedFvg.dir,
      zone: normalizedZone,
    }),
    symbol: symbol.toUpperCase(),
    type: "D1_POI_FVG",
    tf: "D1",
    dir: detectedFvg.dir,
    zone: {
      bottom: normalizedZone.bottomNorm,
      top: normalizedZone.topNorm,
      height: normalizedZone.topNorm - normalizedZone.bottomNorm,
    },
    confTime: detectedFvg.confTime,
    createdAt: detectedFvg.confTime,
    state: "ACTIVE",
    maxForwardBars: 300,
    displayUntil: detectedFvg.confTime + 300 * 24 * 60 * 60 * 1000,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: detectedFvg.atrAtConf,
    structureAtConf,
    passDisplacement,
    passMixedStrongDisp,
  };
}

function updateD1PoisOnBar(args: {
  pois: readonly D1PoiFvg[];
  bar: FvgBar;
  structureEval: StructureEvalResult;
}): D1PoiFvg[] {
  const { pois, bar, structureEval } = args;

  return pois.map((poi) => {
    if (poi.state !== "ACTIVE") {
      return poi;
    }

    const fullFillHit = poi.fullFillHit || evaluateFvgFullFillHit({
      dir: poi.dir,
      zone: poi.zone,
      wickHigh: bar.high,
      wickLow: bar.low,
    });

    const decision = resolveFvgInvalidationDecision(
      evaluateD1PoiFvgInvalidationFlags({
        boxDir: poi.dir,
        fullFillHit,
        structureBreakType: structureEval.breakType,
        nextStructureState: structureEval.nextState,
      })
    );

    return {
      ...poi,
      fullFillHit,
      ...(fullFillHit && !poi.fullFillTime ? { fullFillTime: bar.closeTime } : {}),
      ...(decision.invalidated
        ? {
            state: "INACTIVE" as const,
            invalidReason: decision.invalidReason ?? undefined,
            endTime: bar.closeTime,
          }
        : {}),
    };
  });
}

function updateFvgTouchFields<T extends H4CoreFvg | SetupFvg>(
  box: T,
  bar: FvgBar,
  atrAtBar: number
): T {
  const touchEval = evaluateTouchPenetrationFilter({
    wickHigh: bar.high,
    wickLow: bar.low,
    top: box.zone.top,
    bottom: box.zone.bottom,
    atrForTf: atrAtBar,
  });

  const touched = Boolean(touchEval?.passTouchPenetration);
  const fullFillHit = box.fullFillHit || evaluateFvgFullFillHit({
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

function updateH4CoreFvgsOnBar(args: {
  h4State: FvgContextState;
  h4CoreFvgs: readonly H4CoreFvg[];
  bar: FvgBar;
  structureEval: StructureEvalResult;
}): H4CoreFvg[] {
  const { h4State, h4CoreFvgs, bar, structureEval } = args;
  const atrAtBar = getAtrValueAtConfTime(h4State.bars, bar.closeTime);
  const latestEqHighPair = getLatestPivotPair(h4State.highs, "HIGH");
  const latestEqLowPair = getLatestPivotPair(h4State.lows, "LOW");
  const lastConfirmedPivotHigh = getLatestPivot(h4State.highs, "HIGH");
  const lastConfirmedPivotLow = getLatestPivot(h4State.lows, "LOW");

  return h4CoreFvgs.map((box) => {
    if (box.state === "CANDIDATE") {
      return applyH4CoreFvgCandidateConfirm({
        candidate: box,
        currentCloseTime: bar.closeTime,
        passF2: evaluateH4CoreFvgPassF2({
          dir: box.dir,
          confTime: box.confTime,
          currentCloseTime: bar.closeTime,
          structureBreaks: h4State.structureBreaks,
        }),
        passF3: evaluateH4CoreFvgPassF3({
          tfBars: h4State.bars,
          dir: box.dir,
          confTime: box.confTime,
          currentCloseTime: bar.closeTime,
          eqPivotPair: box.dir === "BULL" ? latestEqLowPair : latestEqHighPair,
          lastConfirmedPivotHigh,
          lastConfirmedPivotLow,
        }),
        passF4: box.passF4,
      });
    }

    if (box.state !== "A_ACTIVE") {
      return box;
    }

    const withFields =
      Number.isFinite(atrAtBar) && (atrAtBar as number) > 0
        ? updateFvgTouchFields(box, bar, atrAtBar as number)
        : box;

    const decision = resolveFvgInvalidationDecision(
      evaluateH4CoreFvgInvalidationFlags({
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

function updateSetupFvgsOnOwnBar(args: {
  setupFvgs: readonly SetupFvg[];
  bar: FvgBar;
  atrAtBar: number | null;
}): SetupFvg[] {
  const { setupFvgs, bar, atrAtBar } = args;

  return setupFvgs.map((box) => {
    if (box.state !== "ACTIVE" || box.tf !== bar.tf) {
      return box;
    }

    const withFields =
      Number.isFinite(atrAtBar) && (atrAtBar as number) > 0
        ? updateFvgTouchFields(box, bar, atrAtBar as number)
        : box;

    const decision = resolveFvgInvalidationDecision(
      evaluateSetupFvgInvalidationFlags({
        fullFillHit: withFields.fullFillHit,
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

function splitFvgBoxes(boxes: readonly AnyFvgBox[]): {
  d1Pois: D1PoiFvg[];
  h4CoreFvgs: H4CoreFvg[];
  setupFvgs: SetupFvg[];
} {
  const d1Pois: D1PoiFvg[] = [];
  const h4CoreFvgs: H4CoreFvg[] = [];
  const setupFvgs: SetupFvg[] = [];

  for (const box of boxes) {
    if (box.type === "D1_POI_FVG") {
      d1Pois.push(box);
    } else if (box.type === "H4_CORE_FVG") {
      h4CoreFvgs.push(box);
    } else if (box.type === "SETUP_FVG") {
      setupFvgs.push(box);
    }
  }

  return { d1Pois, h4CoreFvgs, setupFvgs };
}

function rebuildFvgStackZones(
  symbol: string,
  currentCloseTime: number,
  d1Pois: readonly D1PoiFvg[],
  h4CoreFvgs: readonly H4CoreFvg[],
  setupFvgs: readonly SetupFvg[]
): StackZone[] {
  return createStackZonesInPriorityOrder({
    symbol,
    currentCloseTime,
    d1Pois,
    h4CoreFvgs,
    setupFvgs,
    buildId: ({ high, low }) =>
      buildStackId({
        symbol: symbol.toUpperCase(),
        aId: high.id,
        bId: low.id,
      }),
  });
}

function evaluateReactionLayer(
  state: FvgRuntimeState,
  tf: FvgReactionTf,
  bar: FvgBar
): string[] {
  const reactionState = tf === "M15" ? state.m15 : state.m5;
  reactionState.bars = appendBarKeepingRecent(
    reactionState.bars,
    bar,
    REACTION_BAR_BUFFER_SIZE
  );

  const activePois: LtfGatePoi[] = [
    ...state.d1Pois.filter((poi) => poi.state === "ACTIVE"),
    ...state.h4CoreFvgs.filter((poi) => poi.state === "A_ACTIVE"),
    ...state.setupFvgs.filter((poi) => poi.state === "ACTIVE"),
  ];

  const activeIds = new Set(activePois.map((poi) => poi.id));
  const out: string[] = [];

  for (const poi of activePois) {
    const emissionKey = `${poi.id}|${tf}`;
    const gateKey = buildReactionGateKey(state.symbol, poi.id, poi.dir);
    const gate = state.reactionGates.get(gateKey) ??
      createReactionGate(state.symbol, poi.id, poi.dir);
    const gateEval = evaluateLtfGateFromTfBars(reactionState.bars, poi);
    const triggerEval = evaluateLtfTriggers(reactionState.bars, poi);
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
        nextGate = apply15mReactionToGate(nextGate, bar.closeTime);
      } else if (transition.currStage === "ENTRY_WINDOW_OPEN") {
        nextGate = apply5mEntryToGate(nextGate, bar.closeTime);
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

function detectD1Poi(
  state: FvgRuntimeState,
  tickSize: number
): void {
  const detected = normalizeDetectedFvgToTick(
    detectConfirmedWickFvgWithAtrFromTfBars(state.d1.bars),
    tickSize
  );

  if (!detected || detected.tf !== "D1") {
    return;
  }

  const registration = evaluateD1PoiFvgRegistration({
    detectedFvg: detected,
    structureAtConf: state.d1.structureState,
    displacementEval: evaluateDisplacementF1FromTfBars(state.d1.bars),
    mixedStrongDisplacementEval: evaluateD1MixedStrongDisplacementFromRecentBars(
      state.d1.bars.slice(-3),
      detected.atrAtConf
    ),
  });

  if (!registration.canRegister) {
    return;
  }

  const nextBox = buildD1PoiFvgFromDetected({
    symbol: state.symbol,
    detectedFvg: detected,
    structureAtConf: registration.structureAtConf,
    passDisplacement: registration.passDisplacement,
    passMixedStrongDisp: registration.passMixedStrongDisp,
    tickSize,
  });

  if (!nextBox || state.d1Pois.some((box) => box.id === nextBox.id)) {
    return;
  }

  state.d1Pois = [...state.d1Pois, nextBox];
}

function detectH4Core(
  state: FvgRuntimeState,
  tickSize: number,
  initialPassF4: boolean
): H4CoreFvg | null {
  const detected = normalizeDetectedFvgToTick(
    detectConfirmedWickFvgWithAtrFromTfBars(state.h4.bars),
    tickSize
  );

  if (!detected || detected.tf !== "H4") {
    return null;
  }

  const normalizedZone = normalizeFvgZoneToTick({
    bottom: detected.zone.bottom,
    top: detected.zone.top,
    tick: tickSize,
  });

  if (!normalizedZone) {
    return null;
  }

  const candidateId = buildNormalizedFvgId({
    symbol: state.symbol,
    type: "H4_CORE_FVG",
    tf: "H4",
    confTime: detected.confTime,
    dir: detected.dir,
    zone: normalizedZone,
  });

  if (state.h4CoreFvgs.some((box) => box.id === candidateId)) {
    return null;
  }

  return createH4CoreFvgCandidate({
    id: candidateId,
    symbol: state.symbol,
    detectedFvg: detected,
    displacementEval: evaluateDisplacementF1FromTfBars(state.h4.bars),
    initialPassF2: evaluateH4CoreFvgPassF2({
      dir: detected.dir,
      confTime: detected.confTime,
      currentCloseTime: detected.confTime,
      structureBreaks: state.h4.structureBreaks,
    }),
    initialPassF3: evaluateH4CoreFvgPassF3({
      tfBars: state.h4.bars,
      dir: detected.dir,
      confTime: detected.confTime,
      currentCloseTime: detected.confTime,
      eqPivotPair:
        detected.dir === "BULL"
          ? getLatestPivotPair(state.h4.lows, "LOW")
          : getLatestPivotPair(state.h4.highs, "HIGH"),
      lastConfirmedPivotHigh: getLatestPivot(state.h4.highs, "HIGH"),
      lastConfirmedPivotLow: getLatestPivot(state.h4.lows, "LOW"),
    }),
    initialPassF4,
  });
}

function buildPublishedSnapshotAccessor(symbol: string) {
  return (tf: FvgContextTf, _atOrBefore: number) =>
    listRuntimePois(symbol).filter((poi) => {
      return (
        poi.tf === tf &&
        (poi.kind === "CHANNEL" || poi.kind === "TRENDLINE")
      );
    });
}

function detectH4CorePhaseC(
  state: FvgRuntimeState,
  tickSize: number
): H4CoreFvg | null {
  const detected = normalizeDetectedFvgToTick(
    detectConfirmedWickFvgWithAtrFromTfBars(state.h4.bars),
    tickSize
  );

  if (!detected || detected.tf !== "H4") {
    return null;
  }

  const f4Eval = evaluateF4Context({
    symbol: state.symbol,
    dir: detected.dir,
    confTime: detected.confTime,
    candidateId: `PENDING:${state.symbol}:H4:${detected.confTime}:${detected.dir}`,
    candidateZone: {
      bottomRaw: detected.zone.bottom,
      topRaw: detected.zone.top,
      heightRaw: detected.zone.height,
    },
    atr4hAtConf: detected.atrAtConf,
    getPublishedSnapshot: buildPublishedSnapshotAccessor(state.symbol),
  });

  const candidate = detectH4Core(state, tickSize, f4Eval.passF4);
  if (!candidate) {
    return null;
  }

  state.h4CoreFvgs = [...state.h4CoreFvgs, candidate];
  return candidate;
}

function detectSetupFvg(
  state: FvgRuntimeState,
  tf: "H1" | "M30",
  tickSize: number
): void {
  const bars = tf === "H1" ? state.h1Bars : state.m30Bars;
  const detected = normalizeDetectedFvgToTick(
    detectConfirmedWickFvgWithAtrFromTfBars(bars),
    tickSize
  );

  if (!detected || detected.tf !== tf || !isSetupTf(detected.tf)) {
    return;
  }

  const normalizedZone = normalizeFvgZoneToTick({
    bottom: detected.zone.bottom,
    top: detected.zone.top,
    tick: tickSize,
  });

  if (!normalizedZone) {
    return;
  }

  const setupId = buildNormalizedFvgId({
    symbol: state.symbol,
    type: "SETUP_FVG",
    tf,
    confTime: detected.confTime,
    dir: detected.dir,
    zone: normalizedZone,
  });

  if (state.setupFvgs.some((box) => box.id === setupId)) {
    return;
  }

  const parents: SetupParentPoi[] = [
    ...state.d1Pois.filter((poi) => poi.state === "ACTIVE"),
    ...state.h4CoreFvgs.filter((poi) => poi.state === "A_ACTIVE"),
  ];

  const nextSetup = createSetupFvgFromParentPool({
    id: setupId,
    symbol: state.symbol,
    parents,
    detectedFvg: detected,
    displacementEval: evaluateDisplacementF1FromTfBars(bars),
    h4StructureAtConf: state.h4.structureState,
  });

  if (nextSetup) {
    state.setupFvgs = [...state.setupFvgs, nextSetup];
  }
}

function refreshRuntimeFvgPois(state: FvgRuntimeState): void {
  replaceRuntimeFvgPois(
    state.symbol,
    [
      ...state.d1Pois,
      ...state.h4CoreFvgs,
      ...state.setupFvgs,
    ],
    state.stackZones
  );
}

function applyFvgCrossSourcePhase(
  prevState: FvgRuntimeState,
  bar: Bar
): { nextState: FvgRuntimeState; events: string[] } {
  if (bar.tf !== "H4") {
    return {
      nextState: prevState,
      events: [],
    };
  }

  const state: FvgRuntimeState = {
    ...prevState,
    h4CoreFvgs: [...prevState.h4CoreFvgs],
  };
  const tickSize = getCachedTickSize(state.symbol);

  if (!(Number.isFinite(tickSize) && (tickSize as number) > 0)) {
    return {
      nextState: state,
      events: [],
    };
  }

  const candidate = detectH4CorePhaseC(state, tickSize as number);
  return {
    nextState: state,
    events: candidate
      ? [formatH4CoreFvgCandidateNewEvent(candidate, tickSize as number)]
      : [],
  };
}

export function applyFvgBarClose(
  prevState: FvgRuntimeState,
  bar: Bar,
  options: {
    publishRuntime?: boolean;
  } = {}
): { nextState: FvgRuntimeState; events: string[] } {
  const state: FvgRuntimeState = {
    ...prevState,
    d1: { ...prevState.d1, highs: [...prevState.d1.highs], lows: [...prevState.d1.lows], bars: [...prevState.d1.bars], structureBreaks: [...prevState.d1.structureBreaks] },
    h4: { ...prevState.h4, highs: [...prevState.h4.highs], lows: [...prevState.h4.lows], bars: [...prevState.h4.bars], structureBreaks: [...prevState.h4.structureBreaks] },
    h1Bars: [...prevState.h1Bars],
    m30Bars: [...prevState.m30Bars],
    m15: { bars: [...prevState.m15.bars] },
    m5: { bars: [...prevState.m5.bars] },
    d1Pois: [...prevState.d1Pois],
    h4CoreFvgs: [...prevState.h4CoreFvgs],
    setupFvgs: [...prevState.setupFvgs],
    stackZones: [...prevState.stackZones],
    reactionGates: new Map(prevState.reactionGates),
    emissionStates: new Map(prevState.emissionStates),
  };

  const fvgBar = bar as FvgBar;
  const events: string[] = [];

  if (isLtfReactionTf(bar.tf)) {
    events.push(...evaluateReactionLayer(state, bar.tf, fvgBar));
    if (options.publishRuntime !== false) {
      refreshRuntimeFvgPois(state);
    }
    return { nextState: state, events };
  }

  const tickSize = getCachedTickSize(state.symbol);

  if (isPivotStructureTf(bar.tf)) {
    const current = bar.tf === "D1" ? state.d1 : state.h4;
    const { next, structureEval } = updateContextState(current, fvgBar);

    if (bar.tf === "D1") {
      state.d1 = next;
      if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
        detectD1Poi(state, tickSize as number);
      }
      state.d1Pois = updateD1PoisOnBar({
        pois: state.d1Pois,
        bar: fvgBar,
        structureEval,
      });
    } else {
      state.h4 = next;
      state.h4CoreFvgs = updateH4CoreFvgsOnBar({
        h4State: state.h4,
        h4CoreFvgs: state.h4CoreFvgs,
        bar: fvgBar,
        structureEval,
      });

      const killedH4CoreFvgs = listKilledH4CoreFvgsAtCloseTime(
        state.h4CoreFvgs,
        bar.closeTime
      );
      state.setupFvgs = state.setupFvgs.map((setup) =>
        applySetupFvgOppositeChochKillChain({
          setup,
          killedH4CoreFvgs,
          currentCloseTime: bar.closeTime,
        })
      );
    }
  } else if (bar.tf === "H1" || bar.tf === "M30") {
    const currentBars =
      bar.tf === "H1"
        ? appendBarKeepingRecent(state.h1Bars, fvgBar, DETECT_BAR_BUFFER_SIZE)
        : appendBarKeepingRecent(state.m30Bars, fvgBar, DETECT_BAR_BUFFER_SIZE);

    if (bar.tf === "H1") {
      state.h1Bars = currentBars;
    } else {
      state.m30Bars = currentBars;
    }

    const atrAtBar = getAtrValueAtConfTime(currentBars, bar.closeTime);
    state.setupFvgs = updateSetupFvgsOnOwnBar({
      setupFvgs: state.setupFvgs,
      bar: fvgBar,
      atrAtBar,
    });

    if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
      detectSetupFvg(state, bar.tf, tickSize as number);
    }
  } else {
    return { nextState: state, events };
  }

  const pruned = applyFvgPrune(
    [...state.d1Pois, ...state.h4CoreFvgs, ...state.setupFvgs],
    bar.closeTime
  );
  const split = splitFvgBoxes(pruned);
  state.d1Pois = split.d1Pois;
  state.h4CoreFvgs = split.h4CoreFvgs;
  state.setupFvgs = split.setupFvgs;
  state.stackZones = rebuildFvgStackZones(
    state.symbol,
    bar.closeTime,
    state.d1Pois,
    state.h4CoreFvgs,
    state.setupFvgs
  );

  events.push(
    ...buildFvgLifecycleEvents({
      prevD1Pois: prevState.d1Pois,
      nextD1Pois: state.d1Pois,
      prevH4CoreFvgs: prevState.h4CoreFvgs,
      nextH4CoreFvgs: state.h4CoreFvgs,
      prevSetupFvgs: prevState.setupFvgs,
      nextSetupFvgs: state.setupFvgs,
      prevStackZones: prevState.stackZones,
      nextStackZones: state.stackZones,
      currentCloseTime: bar.closeTime,
      tickSize: Number.isFinite(tickSize) ? (tickSize as number) : null,
    })
  );

  if (options.publishRuntime !== false) {
    refreshRuntimeFvgPois(state);
  }
  return { nextState: state, events };
}

export function createFvgIndicatorEngine(
  symbol: string = "UNKNOWN"
): FvgIndicatorEngine {
  let state = createEmptyFvgRuntimeState(symbol);

  return {
    onBarClose(bar: Bar): string[] {
      const phaseA = applyFvgBarClose(state, bar, {
        publishRuntime: false,
      });
      state = phaseA.nextState;
      refreshRuntimeFvgPois(state);
      const phaseC = applyFvgCrossSourcePhase(state, bar);
      state = phaseC.nextState;
      refreshRuntimeFvgPois(state);
      return [...phaseA.events, ...phaseC.events];
    },
    onBarClosePhaseA(bar: Bar): string[] {
      const result = applyFvgBarClose(state, bar, {
        publishRuntime: false,
      });
      state = result.nextState;
      return result.events;
    },
    onBarClosePhaseC(bar: Bar): string[] {
      const result = applyFvgCrossSourcePhase(state, bar);
      state = result.nextState;
      return result.events;
    },
    publishRuntimeSnapshot(): void {
      refreshRuntimeFvgPois(state);
    },
  };
}
