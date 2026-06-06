import { uniqueLexicographicTags } from "../../engine/tags";
import {
  EDGE_COLDSTART_EXTRA_PENALTY,
  EDGE_LCB_NEG_BLOCK_SC,
  EDGE_LCB_NEG_PENALTY,
  EDGE_MIN_SAMPLES,
  EDGE_NO_EVIDENCE_PENALTY,
  KELLY_DEFAULT_ENABLED,
  KELLY_ENABLE_MIN_SAMPLES,
  KELLY_HALF,
  KELLY_MAX_MULT,
  LCB_Z,
} from "../constants";
import type {
  EdgeEvidenceGateEvalResult,
  EdgeSignatureKeys,
  EdgeSignatureStats,
  PolicyLiquidityState,
  PolicyRegimeBucket,
  PolicyRegimeState,
  SignalCandidate,
} from "../types";

type EvaluateEdgeEvidenceGateArgs = {
  signal: SignalCandidate;
  regimeState: PolicyRegimeState;
  liquidityState: PolicyLiquidityState;
  sc: number;
  isExceptional: boolean;
  fineStats?: EdgeSignatureStats | null;
  midStats?: EdgeSignatureStats | null;
  coarseStats?: EdgeSignatureStats | null;
};

type SelectedEvidence = {
  stats: EdgeSignatureStats | null;
  evidenceLevel: "FINE" | "MID" | "COARSE" | "NO_EVIDENCE";
  usedSignature: "FINE" | "MID" | "COARSE" | "NONE";
};

export function getPolicyRegimeBucket(
  regimeState: PolicyRegimeState,
  liquidityState: PolicyLiquidityState
): PolicyRegimeBucket {
  if (regimeState === "OK" && liquidityState === "NORMAL") {
    return "OK";
  }

  if (regimeState === "TRANSITION") {
    return "TRANSITION";
  }

  return "CAUTION";
}

export function buildEdgeSignatureKeys(
  signal: SignalCandidate,
  regimeState: PolicyRegimeState,
  liquidityState: PolicyLiquidityState
): EdgeSignatureKeys {
  const regimeBucket = getPolicyRegimeBucket(regimeState, liquidityState);

  return {
    coarse: `${signal.poiTier}|${signal.dir}|${regimeBucket}`,
    mid: `${signal.source}|${signal.poiTier}|${signal.dir}|${regimeBucket}`,
    fine: `${signal.source}|${signal.poiTier}|${signal.dir}|${signal.eventType}|${regimeBucket}`,
    regimeBucket,
  };
}

function selectEvidenceStats(args: {
  fineStats?: EdgeSignatureStats | null;
  midStats?: EdgeSignatureStats | null;
  coarseStats?: EdgeSignatureStats | null;
}): SelectedEvidence {
  const { fineStats, midStats, coarseStats } = args;

  if ((fineStats?.n ?? 0) >= EDGE_MIN_SAMPLES) {
    return {
      stats: fineStats as EdgeSignatureStats,
      evidenceLevel: "FINE",
      usedSignature: "FINE",
    };
  }

  if ((midStats?.n ?? 0) >= EDGE_MIN_SAMPLES) {
    return {
      stats: midStats as EdgeSignatureStats,
      evidenceLevel: "MID",
      usedSignature: "MID",
    };
  }

  if ((coarseStats?.n ?? 0) >= EDGE_MIN_SAMPLES) {
    return {
      stats: coarseStats as EdgeSignatureStats,
      evidenceLevel: "COARSE",
      usedSignature: "COARSE",
    };
  }

  return {
    stats: null,
    evidenceLevel: "NO_EVIDENCE",
    usedSignature: "NONE",
  };
}

export function computeLcbR(stats: EdgeSignatureStats): number | null {
  if (
    !Number.isFinite(stats.meanR) ||
    !Number.isFinite(stats.stdR) ||
    !Number.isFinite(stats.n) ||
    stats.n <= 0
  ) {
    return null;
  }

  return stats.meanR - LCB_Z * (stats.stdR / Math.sqrt(stats.n));
}

export function computeKellySuggestedRiskMultiplier(
  stats: EdgeSignatureStats | null
): number | null {
  if (!KELLY_DEFAULT_ENABLED) {
    return null;
  }

  if (!stats || stats.n < KELLY_ENABLE_MIN_SAMPLES) {
    return null;
  }

  const denom = stats.stdR ** 2 + stats.meanR ** 2;
  if (!Number.isFinite(denom) || denom <= 0) {
    return null;
  }

  const raw = (stats.meanR / denom) * KELLY_HALF;
  return Math.min(Math.max(raw, 0), KELLY_MAX_MULT);
}

export function evaluateEdgeEvidenceGate(
  args: EvaluateEdgeEvidenceGateArgs
): EdgeEvidenceGateEvalResult | null {
  const {
    signal,
    regimeState,
    liquidityState,
    sc,
    isExceptional,
    fineStats,
    midStats,
    coarseStats,
  } = args;

  if (!Number.isFinite(sc) || !regimeState || !liquidityState) {
    return null;
  }

  const selected = selectEvidenceStats({
    fineStats,
    midStats,
    coarseStats,
  });

  if (!selected.stats) {
    return {
      decision: "ALLOW",
      scoreDelta:
        EDGE_NO_EVIDENCE_PENALTY + EDGE_COLDSTART_EXTRA_PENALTY,
      tags: uniqueLexicographicTags([
        "EDGE_NO_EVIDENCE",
        "EDGE_COLDSTART",
      ]),
      reasons: [],
      evidenceLevel: "NO_EVIDENCE",
      usedSignature: "NONE",
      lcbR: null,
      suggestedRiskMultiplier: null,
    };
  }

  const lcbR = computeLcbR(selected.stats);
  if (!Number.isFinite(lcbR)) {
    return null;
  }

  if (
    (lcbR as number) < 0 &&
    sc < EDGE_LCB_NEG_BLOCK_SC &&
    signal.collabStrength !== "STRONG" &&
    isExceptional === false
  ) {
    return {
      decision: "BLOCK",
      scoreDelta: 0,
      tags: [],
      reasons: ["EDGE_LCB_NEG_BLOCK"],
      evidenceLevel: selected.evidenceLevel,
      usedSignature: selected.usedSignature,
      lcbR: lcbR as number,
      suggestedRiskMultiplier: computeKellySuggestedRiskMultiplier(selected.stats),
    };
  }

  if ((lcbR as number) < 0) {
    return {
      decision: "ALLOW",
      scoreDelta: EDGE_LCB_NEG_PENALTY,
      tags: ["EDGE_LCB_NEG_OVERRIDE"],
      reasons: [],
      evidenceLevel: selected.evidenceLevel,
      usedSignature: selected.usedSignature,
      lcbR: lcbR as number,
      suggestedRiskMultiplier: computeKellySuggestedRiskMultiplier(selected.stats),
    };
  }

  return {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    evidenceLevel: selected.evidenceLevel,
    usedSignature: selected.usedSignature,
    lcbR: lcbR as number,
    suggestedRiskMultiplier: computeKellySuggestedRiskMultiplier(selected.stats),
  };
}
