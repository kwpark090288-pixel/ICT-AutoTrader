import {
  advanceSourceEmissionState,
  type SourceEmissionState,
} from "../../source-emission";
import {
  listRuntimePois,
  replaceRuntimeTrendlinePois,
  syncRuntimeTrendlineInvalidationPois,
} from "../../runtime-poi-store";
import { getAtrValueAtCloseTime } from "../../atr";
import type { IndicatorEngine } from "../../contracts";
import { getCachedTickSize } from "../../ticksize";
import type { Bar } from "../../types";
import {
  appendTrendlinePivotKeepingLast3,
  detectNewlyConfirmedTrendlinePivot,
} from "./pivots";
import { buildTrendlineStructureSnapshot } from "./structure";
import {
  detectTrendlineCandidates,
  getTrendlineLookbackBars,
  isTrendlineDetectTf,
} from "./detect";
import {
  resolveTrendlineInvalidEvent,
  resolveTrendlineNewEvent,
  resolveTrendlinePoiCandidateEvent,
  resolveTrendlineRoleFlipEvent,
  resolveTrendlineTouchEvent,
} from "./events";
import {
  applyTrendlineLifecycleInvalidation,
  applyTrendlineTouchAndBreakStats,
  evaluateTrendlineBreakAtBar,
  evaluateTrendlineStaleExpiration,
  evaluateTrendlineTouchAtBar,
} from "./lifecycle";
import {
  evaluateTrendlineLtfGateFromTfBars,
  evaluateTrendlineLtfTriggersFromTfBars,
  isTrendlineReactionTf,
} from "./ltf";
import {
  applyTrendlineCollabSnapshot,
  evaluateTrendlineCollabFromRuntimePois,
  stripTrendlineCollabTags,
} from "./collab";
import { buildTrendlineDailyCapKey, buildTrendlinePoiCandidateEventInput } from "./poi";
import { applyTrendlinePruneByType } from "./prune";
import { applyTrendlineRoleFlip } from "./role-flip";
import type {
  Pivot,
  Trendline,
  TrendlineModelTf,
  TrendlineReactionTf,
} from "./types";

export type TrendlineIndicatorEngine = IndicatorEngine;

type TrendlineTfState = {
  bars: Bar[];
  highs: Pivot[];
  lows: Pivot[];
  activeLines: Map<string, Trendline>;
};

type TrendlineReactionTfState = {
  bars: Bar[];
};

function createEmptyTfState(): TrendlineTfState {
  return {
    bars: [],
    highs: [],
    lows: [],
    activeLines: new Map<string, Trendline>(),
  };
}

function createEmptyReactionTfState(): TrendlineReactionTfState {
  return {
    bars: [],
  };
}

function getBarBufferSize(tf: TrendlineModelTf): number {
  return Math.max(getTrendlineLookbackBars(tf) + 20, 64);
}

function getReactionBarBufferSize(): number {
  return 64;
}

function appendBarKeepingRecent(
  bars: readonly Bar[],
  nextBar: Bar,
  maxSize: number
): Bar[] {
  if (bars.length > 0) {
    const last = bars[bars.length - 1];

    if (nextBar.closeTime <= last.closeTime) {
      return [...bars];
    }
  }

  const next = [...bars, nextBar];
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

function updateActiveTrendlineOnBar(args: {
  line: Trendline;
  bar: Bar;
  tfBars: readonly Bar[];
  currentIndex: number;
  structureState: "UP" | "DOWN" | "MIXED";
  atrAtBar: number;
}): Trendline {
  const {
    line,
    bar,
    tfBars,
    currentIndex,
    structureState,
    atrAtBar,
  } = args;

  const touchEval =
    Number.isFinite(atrAtBar) && atrAtBar > 0
      ? evaluateTrendlineTouchAtBar({
          line,
          bar,
          atrAtBar,
        })
      : null;

  const breakEval =
    Number.isFinite(atrAtBar) && atrAtBar > 0
      ? evaluateTrendlineBreakAtBar({
          line,
          tfBars,
          currentIndex,
          atrAtBar,
          structureState,
        })
      : null;

  const staleEval = evaluateTrendlineStaleExpiration(line, bar.closeTime);

  const withStats = applyTrendlineTouchAndBreakStats({
    line,
    touchEval,
    breakEval,
  });

  const withRoleFlip = applyTrendlineRoleFlip({
    line: withStats,
    bar,
    breakEval,
    touchEval,
  });

  return applyTrendlineLifecycleInvalidation({
    line: withRoleFlip,
    currentCloseTime: bar.closeTime,
    breakEval,
    staleEval,
  });
}

function hasTrendlineSourceLocalUpdate(
  prev: Trendline,
  next: Trendline
): boolean {
  return (
    prev.type !== next.type ||
    prev.state !== next.state ||
    prev.touchCount !== next.touchCount ||
    prev.lastTouchTime !== next.lastTouchTime ||
    prev.breakStreak !== next.breakStreak ||
    prev.lastBreakTime !== next.lastBreakTime ||
    prev.roleFlipCount !== next.roleFlipCount ||
    JSON.stringify(prev.roleFlipWatch ?? null) !==
      JSON.stringify(next.roleFlipWatch ?? null) ||
    prev.invalidReason !== next.invalidReason ||
    prev.endTime !== next.endTime
  );
}

function applyTrendlineLastUpdatedAt(
  prev: Trendline,
  next: Trendline,
  currentCloseTime: number
): Trendline {
  const baseUpdatedAt = prev.lastUpdatedAt ?? prev.createdAt;

  if (!hasTrendlineSourceLocalUpdate(prev, next)) {
    return {
      ...next,
      lastUpdatedAt: baseUpdatedAt,
    };
  }

  return {
    ...next,
    lastUpdatedAt: currentCloseTime,
  };
}

export function createTrendlineIndicatorEngine(
  symbol: string = "UNKNOWN"
): TrendlineIndicatorEngine {
  const tfStates = new Map<TrendlineModelTf, TrendlineTfState>();
  const reactionTfStates = new Map<TrendlineReactionTf, TrendlineReactionTfState>();
  const emissionStates = new Map<string, SourceEmissionState>();
  const dailyCaps = new Map<string, number>();
  const trackedLines = new Map<string, Trendline>();

  function getTfState(tf: TrendlineModelTf): TrendlineTfState {
    const existing = tfStates.get(tf);
    if (existing) {
      return existing;
    }

    const created = createEmptyTfState();
    tfStates.set(tf, created);
    return created;
  }

  function getReactionTfState(tf: TrendlineReactionTf): TrendlineReactionTfState {
    const existing = reactionTfStates.get(tf);
    if (existing) {
      return existing;
    }

    const created = createEmptyReactionTfState();
    reactionTfStates.set(tf, created);
    return created;
  }

  function getAllActiveLines(): Trendline[] {
    const out = new Map<string, Trendline>();

    for (const state of tfStates.values()) {
      for (const line of state.activeLines.values()) {
        if (line.state === "ACTIVE") {
          out.set(line.id, line);
        }
      }
    }

    return [...out.values()];
  }

  function clearInactiveEmissionStates(activeLines: readonly Trendline[]): void {
    const activeLineIds = new Set(activeLines.map((line) => line.id));

    for (const key of [...emissionStates.keys()]) {
      const lineId = key.split("|")[0];
      if (!activeLineIds.has(lineId)) {
        emissionStates.delete(key);
      }
    }
  }

  function applyPhaseABarClose(bar: Bar): string[] {
    if (isTrendlineReactionTf(bar.tf)) {
      const reactionState = getReactionTfState(bar.tf);
      reactionState.bars = appendBarKeepingRecent(
        reactionState.bars,
        bar,
        getReactionBarBufferSize()
      );

      const tickSize = getCachedTickSize(symbol);
      const activeLines = getAllActiveLines();
      const activeKeys = new Set<string>();
      const out: string[] = [];

      if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
        for (const line of activeLines) {
          const key = `${line.id}|${bar.tf}`;
          activeKeys.add(key);

          const gateEval = evaluateTrendlineLtfGateFromTfBars({
            line,
            tfBars: reactionState.bars,
          });

          const triggerEval = evaluateTrendlineLtfTriggersFromTfBars({
            line,
            tfBars: reactionState.bars,
            tickSize: tickSize as number,
          });

          const transition = advanceSourceEmissionState({
            prev: emissionStates.get(key),
            ltf: bar.tf,
            closeTime: bar.closeTime,
            poiId: line.id,
            gatePass: Boolean(gateEval?.passGate),
            currentTriggers: triggerEval?.triggers ?? [],
          });

          emissionStates.set(key, transition.next);

          if (transition.event) {
            out.push(transition.event);
          }
        }
      }

      for (const key of [...emissionStates.keys()]) {
        if (key.endsWith(`|${bar.tf}`) && !activeKeys.has(key)) {
          emissionStates.delete(key);
        }
      }

      return out;
    }

    if (!isTrendlineDetectTf(bar.tf)) {
      return [];
    }

    const tf = bar.tf;
    const state = getTfState(tf);
    const out: string[] = [];

    state.bars = appendBarKeepingRecent(
      state.bars,
      bar,
      getBarBufferSize(tf)
    );

    const newHigh = detectNewlyConfirmedTrendlinePivot(state.bars, "HIGH");
    if (newHigh) {
      state.highs = appendTrendlinePivotKeepingLast3(state.highs, newHigh);
    }

    const newLow = detectNewlyConfirmedTrendlinePivot(state.bars, "LOW");
    if (newLow) {
      state.lows = appendTrendlinePivotKeepingLast3(state.lows, newLow);
    }

    const structureSnapshot = buildTrendlineStructureSnapshot({
      tf,
      time: bar.closeTime,
      highs: state.highs,
      lows: state.lows,
    });

    const structureState = structureSnapshot?.state ?? "MIXED";
    const currentIndex = state.bars.length - 1;
    const atrAtBar =
      getAtrValueAtCloseTime(state.bars, bar.closeTime) ?? Number.NaN;
    const prevActiveLines = [...state.activeLines.values()];
    const nextActiveLines = new Map<string, Trendline>();
    const intermediateExistingLines = new Map<string, Trendline>();
    const candidateIds = new Set<string>();

    for (const line of prevActiveLines) {
      const sourceLocalNextLine = updateActiveTrendlineOnBar({
        line,
        bar,
        tfBars: state.bars,
        currentIndex,
        structureState,
        atrAtBar,
      });
      const nextLine = applyTrendlineLastUpdatedAt(
        line,
        sourceLocalNextLine,
        bar.closeTime
      );

      intermediateExistingLines.set(line.id, nextLine);

      if (nextLine.state === "ACTIVE") {
        nextActiveLines.set(nextLine.id, nextLine);
      }
    }

    if (structureSnapshot) {
      const candidates = detectTrendlineCandidates({
        symbol,
        tf,
        currentCloseTime: bar.closeTime,
        structureState: structureSnapshot.state,
        highs: state.highs,
        lows: state.lows,
        bars: state.bars,
        atrAtHighAnchor2: Number.NaN,
        atrAtLowAnchor2: Number.NaN,
      });

      for (const candidate of candidates) {
        if (nextActiveLines.has(candidate.id)) {
          continue;
        }

        nextActiveLines.set(candidate.id, candidate);
        candidateIds.add(candidate.id);
      }
    }

    const pruned = applyTrendlinePruneByType({
      lines: [...nextActiveLines.values()],
      currentCloseTime: bar.closeTime,
    });

    const activeAfterPrune = new Map<string, Trendline>();
    for (const line of pruned.active) {
      activeAfterPrune.set(line.id, line);
    }

    const finalExistingLines = new Map<string, Trendline>();
    for (const prevLine of prevActiveLines) {
      const intermediate = intermediateExistingLines.get(prevLine.id) ?? prevLine;
      const prunedLine = pruned.pruned.find((line) => line.id === prevLine.id);
      finalExistingLines.set(
        prevLine.id,
        prunedLine ?? activeAfterPrune.get(prevLine.id) ?? intermediate
      );
    }

    for (const prevLine of prevActiveLines) {
      const intermediate = intermediateExistingLines.get(prevLine.id) ?? prevLine;
      const finalLine =
        activeAfterPrune.get(prevLine.id) ??
        finalExistingLines.get(prevLine.id) ??
        intermediate;

      const touchEvent = resolveTrendlineTouchEvent(
        bar.closeTime,
        prevLine,
        intermediate
      );
      const roleFlipEvent = resolveTrendlineRoleFlipEvent(
        bar.closeTime,
        prevLine,
        intermediate
      );
      const invalidEvent = resolveTrendlineInvalidEvent(
        bar.closeTime,
        prevLine,
        finalLine
      );

      if (touchEvent) {
        out.push(touchEvent);
      }

      if (roleFlipEvent) {
        out.push(roleFlipEvent);
      }

      if (invalidEvent) {
        out.push(invalidEvent);
      }
    }

    for (const candidateId of candidateIds) {
      const candidate = activeAfterPrune.get(candidateId);
      if (!candidate) {
        continue;
      }

      const event = resolveTrendlineNewEvent(bar.closeTime, undefined, candidate);
      if (event) {
        out.push(event);
      }
    }

    state.activeLines = activeAfterPrune;
    for (const line of finalExistingLines.values()) {
      trackedLines.set(line.id, line);
    }
    for (const line of activeAfterPrune.values()) {
      trackedLines.set(line.id, line);
    }
    clearInactiveEmissionStates(getAllActiveLines());

    return out;
  }

  function applyPhaseCBarClose(bar: Bar): string[] {
    if (!isTrendlineDetectTf(bar.tf)) {
      return [];
    }

    const tf = bar.tf;
    const state = getTfState(tf);
    const atrAtBar =
      getAtrValueAtCloseTime(state.bars, bar.closeTime) ?? Number.NaN;
    const tickSize = getCachedTickSize(symbol);
    const runtimePois = listRuntimePois(symbol);
    const finalActiveLines = new Map<string, Trendline>();
    const out: string[] = [];

    for (const line of state.activeLines.values()) {
      const lineWithoutOldCollab = {
        ...line,
        tags: stripTrendlineCollabTags(line.tags),
        bestMatch: { kind: "NONE" as const },
      };

      const collab =
        Number.isFinite(atrAtBar) &&
        atrAtBar > 0 &&
        Number.isFinite(tickSize) &&
        (tickSize as number) > 0
          ? evaluateTrendlineCollabFromRuntimePois({
              line: lineWithoutOldCollab,
              currentCloseTime: bar.closeTime,
              atrAtBar: atrAtBar as number,
              tick: tickSize as number,
              pois: runtimePois,
            })
          : { tags: [], bestMatch: { kind: "NONE" as const } };

      finalActiveLines.set(
        line.id,
        applyTrendlineCollabSnapshot(lineWithoutOldCollab, collab)
      );
    }

    if (tf === "H1" || tf === "M30") {
      for (const line of finalActiveLines.values()) {
        const capKey = buildTrendlineDailyCapKey(symbol, tf, bar.closeTime);
        const currentDailyCapCount = dailyCaps.get(capKey) ?? 0;
        const poiInput = buildTrendlinePoiCandidateEventInput({
          line,
          currentCloseTime: bar.closeTime,
          currentDailyCapCount,
        });
        const event = resolveTrendlinePoiCandidateEvent(undefined, poiInput);

        if (event) {
          out.push(event);
          dailyCaps.set(capKey, currentDailyCapCount + 1);
        }
      }
    }

    state.activeLines = finalActiveLines;
    for (const line of finalActiveLines.values()) {
      trackedLines.set(line.id, line);
    }
    return out;
  }

  return {
    onBarClose(bar: Bar): string[] {
      const phaseAEvents = applyPhaseABarClose(bar);
      replaceRuntimeTrendlinePois(symbol, getAllActiveLines());
      syncRuntimeTrendlineInvalidationPois(symbol, [...trackedLines.values()]);
      const phaseCEvents = applyPhaseCBarClose(bar);
      replaceRuntimeTrendlinePois(symbol, getAllActiveLines());
      syncRuntimeTrendlineInvalidationPois(symbol, [...trackedLines.values()]);
      return [...phaseAEvents, ...phaseCEvents];
    },
    onBarClosePhaseA(bar: Bar): string[] {
      return applyPhaseABarClose(bar);
    },
    onBarClosePhaseC(bar: Bar): string[] {
      return applyPhaseCBarClose(bar);
    },
    publishRuntimeSnapshot(): void {
      replaceRuntimeTrendlinePois(symbol, getAllActiveLines());
      syncRuntimeTrendlineInvalidationPois(symbol, [...trackedLines.values()]);
    },
  };
}

