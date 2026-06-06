import { uniqueLexicographicTags } from "../../engine/tags";
import {
  LIQUIDITY_LOW_PENALTY,
  LIQUIDITY_Q_LOW,
  REGIME_CAUTION_PENALTY,
  REGIME_TRANSITION_PENALTY,
  SPREAD_CAUTION_BPS,
  SPREAD_CAUTION_PENALTY,
  SPREAD_HALT_BPS,
  VOL_Q_HIGH,
  VOL_Q_LOW,
  VOLSHIFT_RATIO_TH,
  VOLSHIFT_SHORT_Q,
} from "../constants";
import type {
  PolicyLiquidityState,
  PolicyRegimeState,
  PolicyVolState,
  RegimeGateEvalResult,
} from "../types";

type EvaluateRegimeGateArgs = {
  spreadBps: number;
  atr14BpsNow: number;
  volumeM5: number;
  longAtr14BpsHistory: number[];
  shortAtr14BpsHistory: number[];
  longVolumeM5History: number[];
};

export function quantileNearestRank(
  values: readonly number[],
  q: number
): number | null {
  const filtered = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

  if (!filtered.length) {
    return null;
  }

  if (!Number.isFinite(q) || q <= 0 || q > 1) {
    return null;
  }

  const rank = Math.ceil(q * filtered.length);
  return filtered[Math.max(0, rank - 1)];
}

export function meanOf(values: readonly number[]): number | null {
  const filtered = values.filter((v) => Number.isFinite(v));

  if (!filtered.length) {
    return null;
  }

  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

export function computeVolState(
  atr14BpsNow: number,
  longAtr14BpsHistory: readonly number[]
): PolicyVolState | null {
  if (!Number.isFinite(atr14BpsNow)) {
    return null;
  }

  const qLow = quantileNearestRank(longAtr14BpsHistory, VOL_Q_LOW);
  const qHigh = quantileNearestRank(longAtr14BpsHistory, VOL_Q_HIGH);

  if (!Number.isFinite(qLow) || !Number.isFinite(qHigh)) {
    return null;
  }

  if (atr14BpsNow <= (qLow as number)) {
    return "LOW";
  }

  if (atr14BpsNow >= (qHigh as number)) {
    return "HIGH";
  }

  return "NORMAL";
}

export function computeAtrRatio(
  atr14BpsNow: number,
  longAtr14BpsHistory: readonly number[]
): number | null {
  if (!Number.isFinite(atr14BpsNow)) {
    return null;
  }

  const mean = meanOf(longAtr14BpsHistory);
  if (!Number.isFinite(mean) || mean === 0) {
    return null;
  }

  return atr14BpsNow / (mean as number);
}

export function computeLiquidityState(
  volumeM5: number,
  longVolumeM5History: readonly number[]
): PolicyLiquidityState | null {
  if (!Number.isFinite(volumeM5)) {
    return null;
  }

  const qLow = quantileNearestRank(longVolumeM5History, LIQUIDITY_Q_LOW);
  if (!Number.isFinite(qLow)) {
    return null;
  }

  return volumeM5 <= (qLow as number) ? "LOW" : "NORMAL";
}

function maxRegimeState(
  a: PolicyRegimeState,
  b: PolicyRegimeState
): PolicyRegimeState {
  const order: Record<PolicyRegimeState, number> = {
    OK: 0,
    CAUTION: 1,
    TRANSITION: 2,
    HALT: 3,
  };

  return order[a] >= order[b] ? a : b;
}

export function evaluateRegimeGate(
  args: EvaluateRegimeGateArgs
): RegimeGateEvalResult | null {
  const {
    spreadBps,
    atr14BpsNow,
    volumeM5,
    longAtr14BpsHistory,
    shortAtr14BpsHistory,
    longVolumeM5History,
  } = args;

  if (
    !Number.isFinite(spreadBps) ||
    !Number.isFinite(atr14BpsNow) ||
    !Number.isFinite(volumeM5)
  ) {
    return null;
  }

  const volState = computeVolState(atr14BpsNow, longAtr14BpsHistory);
  const liquidityState = computeLiquidityState(volumeM5, longVolumeM5History);
  const atrRatio = computeAtrRatio(atr14BpsNow, longAtr14BpsHistory);
  const q95Short = quantileNearestRank(shortAtr14BpsHistory, VOLSHIFT_SHORT_Q);

  if (
    !volState ||
    !liquidityState ||
    !Number.isFinite(atrRatio) ||
    !Number.isFinite(q95Short)
  ) {
    return null;
  }

  if (spreadBps > SPREAD_HALT_BPS) {
    return {
      decision: "BLOCK",
      scoreDelta: 0,
      tags: [],
      reasons: ["REGIME_SPREAD_HALT"],
      regimeState: "HALT",
      volState,
      liquidityState,
      atrRatio: atrRatio as number,
      q95Short: q95Short as number,
    };
  }

  let regimeState: PolicyRegimeState = "OK";
  let scoreDelta = 0;
  const tags: string[] = [];
  const reasons: string[] = [];

  const shiftStrong =
    (atrRatio as number) >= VOLSHIFT_RATIO_TH &&
    atr14BpsNow >= (q95Short as number);

  const shiftWeak =
    (((atrRatio as number) >= VOLSHIFT_RATIO_TH) ||
      atr14BpsNow >= (q95Short as number)) &&
    !shiftStrong;

  if (shiftStrong) {
    regimeState = "TRANSITION";
  } else if (shiftWeak) {
    regimeState = "CAUTION";
  }

  if (spreadBps > SPREAD_CAUTION_BPS) {
    regimeState = maxRegimeState(regimeState, "CAUTION");
    scoreDelta += SPREAD_CAUTION_PENALTY;
    tags.push("SPREAD_CAUTION");
  }

  if (liquidityState === "LOW") {
    scoreDelta += LIQUIDITY_LOW_PENALTY;
    tags.push("LIQUIDITY_LOW");
  }

  if (regimeState === "CAUTION") {
    scoreDelta += REGIME_CAUTION_PENALTY;
    tags.push("REGIME_CAUTION");
  } else if (regimeState === "TRANSITION") {
    scoreDelta += REGIME_TRANSITION_PENALTY;
    tags.push("REGIME_TRANSITION");
  }

  return {
    decision: "ALLOW",
    scoreDelta,
    tags: uniqueLexicographicTags(tags),
    reasons: uniqueLexicographicTags(reasons),
    regimeState,
    volState,
    liquidityState,
    atrRatio: atrRatio as number,
    q95Short: q95Short as number,
  };
}
