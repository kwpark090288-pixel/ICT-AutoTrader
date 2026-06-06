import { uniqueLexicographicTags } from "../../engine/tags";
import {
  CONC_DUPLICATE_PENALTY,
  CONC_OVERRIDE_PENALTY,
  MAX_UNIQUE_CLUSTERS_15M_PER_DIR,
  WINDOW_CONC_15M_MIN,
} from "../constants";
import type {
  ConcentrationGateEvalResult,
  ConcentrationHistoryItem,
  SignalCandidate,
} from "../types";

type EvaluateConcentrationGateArgs = {
  signal: SignalCandidate;
  poiClusterKey: string | null;
  recentHistory15m: readonly ConcentrationHistoryItem[];
};

function parseIsoTime(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function getWindowedHistory(
  signal: SignalCandidate,
  recentHistory15m: readonly ConcentrationHistoryItem[]
): ConcentrationHistoryItem[] | null {
  const currentTime = parseIsoTime(signal.time);
  if (!Number.isFinite(currentTime)) {
    return null;
  }

  const windowStart = (currentTime as number) - WINDOW_CONC_15M_MIN * 60 * 1000;

  return recentHistory15m.filter((item) => {
    const itemTime = parseIsoTime(item.time);
    if (!Number.isFinite(itemTime)) {
      return false;
    }

    return (
      item.symbol.toUpperCase() === signal.symbol.toUpperCase() &&
      item.dir === signal.dir &&
      (itemTime as number) >= windowStart &&
      (itemTime as number) < (currentTime as number)
    );
  });
}

export function isExceptionalSignal(
  signal: SignalCandidate
): boolean {
  const triggerCount = signal.triggerCount ?? 0;
  const hasStack = signal.hasStack ?? false;
  const collabStrength = signal.collabStrength ?? "NONE";

  if (
    signal.eventType === "ENTRY_WINDOW_OPEN" &&
    triggerCount >= 2 &&
    (
      signal.poiTier === "D1_POI" ||
      hasStack === true ||
      collabStrength === "STRONG"
    )
  ) {
    return true;
  }

  if (
    signal.eventType === "REACTION" &&
    signal.poiTier === "D1_POI" &&
    collabStrength === "STRONG" &&
    triggerCount >= 2
  ) {
    return true;
  }

  return false;
}

export function countUniquePoiClusters15m(
  signal: SignalCandidate,
  recentHistory15m: readonly ConcentrationHistoryItem[]
): number | null {
  const history = getWindowedHistory(signal, recentHistory15m);
  if (!history) {
    return null;
  }

  return new Set(history.map((item) => item.poiClusterKey)).size;
}

export function hasDuplicatePoiCluster(
  signal: SignalCandidate,
  poiClusterKey: string,
  recentHistory15m: readonly ConcentrationHistoryItem[]
): boolean | null {
  const history = getWindowedHistory(signal, recentHistory15m);
  if (!history) {
    return null;
  }

  return history.some((item) => item.poiClusterKey === poiClusterKey);
}

export function evaluateConcentrationGate(
  args: EvaluateConcentrationGateArgs
): ConcentrationGateEvalResult | null {
  const { signal, poiClusterKey, recentHistory15m } = args;

  if (!poiClusterKey) {
    return null;
  }

  const uniqueClusters15m = countUniquePoiClusters15m(signal, recentHistory15m);
  const duplicate = hasDuplicatePoiCluster(signal, poiClusterKey, recentHistory15m);

  if (uniqueClusters15m === null || duplicate === null) {
    return null;
  }

  const isExceptional = isExceptionalSignal(signal);

  if (duplicate) {
    return {
      decision: "ALLOW",
      scoreDelta: CONC_DUPLICATE_PENALTY,
      tags: ["CONC_DUPLICATE"],
      reasons: [],
      uniqueClusters15m,
      duplicate: true,
      isExceptional,
    };
  }

  if (uniqueClusters15m >= MAX_UNIQUE_CLUSTERS_15M_PER_DIR) {
    if (!isExceptional) {
      return {
        decision: "BLOCK",
        scoreDelta: 0,
        tags: [],
        reasons: ["CONC_TOO_MANY"],
        uniqueClusters15m,
        duplicate: false,
        isExceptional: false,
      };
    }

    return {
      decision: "ALLOW",
      scoreDelta: CONC_OVERRIDE_PENALTY,
      tags: uniqueLexicographicTags(["CONC_OVERRIDE"]),
      reasons: uniqueLexicographicTags(["CONC_OVERRIDE"]),
      uniqueClusters15m,
      duplicate: false,
      isExceptional: true,
    };
  }

  return {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    uniqueClusters15m,
    duplicate: false,
    isExceptional,
  };
}
