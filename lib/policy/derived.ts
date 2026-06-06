import {
  FAST_MOVE_BARCHANGE_ATR_RATIO,
  FEE_BPS_ROUNDTRIP_DEFAULT,
  POI_CLUSTER_STEP_BPS,
  REWARDPROXY_HIGH_SC,
  REWARDPROXY_MID_SC,
  SLIPPAGE_BPS_FLOOR,
  STOP_BUFFER_ATR_HIGH,
  STOP_BUFFER_ATR_LOW,
  STOP_BUFFER_ATR_NORMAL,
  STOP_BUFFER_TICKS_MIN,
} from "./constants";
import type {
  PolicyLiquidityState,
  PolicyPoiTier,
  PolicyRegimeState,
  PolicyRewardProxy,
  PolicyVolState,
} from "./types";

export function computeSpreadBps(
  bid: number,
  ask: number,
  mid: number
): number | null {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(mid)) {
    return null;
  }

  if (mid <= 0) {
    return null;
  }

  return ((ask - bid) / mid) * 10000;
}

export function estimateSlippageBpsP95(
  spreadBps: number
): number | null {
  if (!Number.isFinite(spreadBps)) {
    return null;
  }

  return Math.max(SLIPPAGE_BPS_FLOOR, spreadBps * 0.6);
}

export function computeSlippageMultiplier(args: {
  liquidityState: PolicyLiquidityState;
  regimeState: PolicyRegimeState;
  fastMove: boolean;
}): number {
  const { liquidityState, regimeState, fastMove } = args;

  let multiplier = 1.0;

  if (liquidityState === "LOW") {
    multiplier *= 1.5;
  }

  if (regimeState === "TRANSITION") {
    multiplier *= 2.0;
  }

  if (fastMove) {
    multiplier *= 2.0;
  }

  return multiplier;
}

export function computeFastMove(
  barChangeBpsM5: number,
  atr14Bps: number
): boolean {
  if (!Number.isFinite(barChangeBpsM5) || !Number.isFinite(atr14Bps)) {
    return false;
  }

  return barChangeBpsM5 > atr14Bps * FAST_MOVE_BARCHANGE_ATR_RATIO;
}

export function computeEntryRefPrice(
  midPrice: number,
  lastPrice: number
): number | null {
  if (Number.isFinite(midPrice) && midPrice !== 0) {
    return midPrice;
  }

  if (Number.isFinite(lastPrice)) {
    return lastPrice;
  }

  return null;
}

export function getStopBufferAtrFactor(
  volState: PolicyVolState
): number {
  if (volState === "LOW") {
    return STOP_BUFFER_ATR_LOW;
  }

  if (volState === "HIGH") {
    return STOP_BUFFER_ATR_HIGH;
  }

  return STOP_BUFFER_ATR_NORMAL;
}

export function computeStopBufferPrice(
  tickSize: number,
  ltAtr14: number,
  volState: PolicyVolState
): number | null {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  if (!Number.isFinite(ltAtr14) || ltAtr14 <= 0) {
    return null;
  }

  return Math.max(
    STOP_BUFFER_TICKS_MIN * tickSize,
    ltAtr14 * getStopBufferAtrFactor(volState)
  );
}

export function computeSRawBps(
  entryRefPrice: number,
  hardInvalidationPrice: number
): number | null {
  if (!Number.isFinite(entryRefPrice) || !Number.isFinite(hardInvalidationPrice)) {
    return null;
  }

  if (entryRefPrice <= 0) {
    return null;
  }

  return (Math.abs(entryRefPrice - hardInvalidationPrice) / entryRefPrice) * 10000;
}

export function computeStopBufferBps(
  entryRefPrice: number,
  stopBufferPrice: number
): number | null {
  if (!Number.isFinite(entryRefPrice) || !Number.isFinite(stopBufferPrice)) {
    return null;
  }

  if (entryRefPrice <= 0) {
    return null;
  }

  return (stopBufferPrice / entryRefPrice) * 10000;
}

export function computeSEffectiveBps(
  sRawBps: number,
  stopBufferBps: number
): number | null {
  if (!Number.isFinite(sRawBps) || !Number.isFinite(stopBufferBps)) {
    return null;
  }

  return sRawBps + stopBufferBps;
}

export function computeCostRoundtripBps(args: {
  spreadBps: number;
  slippageBpsP95: number;
  slippageMultiplier: number;
  feeBpsRoundtrip?: number;
}): number | null {
  const {
    spreadBps,
    slippageBpsP95,
    slippageMultiplier,
    feeBpsRoundtrip = FEE_BPS_ROUNDTRIP_DEFAULT,
  } = args;

  if (
    !Number.isFinite(spreadBps) ||
    !Number.isFinite(slippageBpsP95) ||
    !Number.isFinite(slippageMultiplier) ||
    !Number.isFinite(feeBpsRoundtrip)
  ) {
    return null;
  }

  return feeBpsRoundtrip + spreadBps + slippageBpsP95 * slippageMultiplier;
}

export function computeSC(
  sEffectiveBps: number,
  cBpsRoundtrip: number
): number | null {
  if (!Number.isFinite(sEffectiveBps) || !Number.isFinite(cBpsRoundtrip)) {
    return null;
  }

  if (cBpsRoundtrip <= 0) {
    return null;
  }

  return sEffectiveBps / cBpsRoundtrip;
}

export function computeRewardBpsFromTpRefPrice(
  entryRefPrice: number,
  tpRefPrice: number
): number | null {
  if (!Number.isFinite(entryRefPrice) || !Number.isFinite(tpRefPrice)) {
    return null;
  }

  if (entryRefPrice <= 0) {
    return null;
  }

  return (Math.abs(tpRefPrice - entryRefPrice) / entryRefPrice) * 10000;
}

export function computeExpectedRRUsed(args: {
  expectedRR?: number | null;
  tpRefPrice?: number | null;
  entryRefPrice: number;
  sEffectiveBps: number;
}): number | null {
  const { expectedRR, tpRefPrice, entryRefPrice, sEffectiveBps } = args;

  if (Number.isFinite(expectedRR as number)) {
    return expectedRR as number;
  }

  if (!Number.isFinite(tpRefPrice as number)) {
    return null;
  }

  if (!Number.isFinite(sEffectiveBps) || sEffectiveBps <= 0) {
    return null;
  }

  const rewardBps = computeRewardBpsFromTpRefPrice(
    entryRefPrice,
    tpRefPrice as number
  );

  if (!Number.isFinite(rewardBps)) {
    return null;
  }

  return (rewardBps as number) / sEffectiveBps;
}

export function computeRewardProxy(args: {
  poiTier: PolicyPoiTier;
  hasStack: boolean;
  sc: number;
}): PolicyRewardProxy {
  const { poiTier, hasStack, sc } = args;

  if (poiTier === "D1_POI" && sc >= REWARDPROXY_HIGH_SC) {
    return "HIGH";
  }

  if (
    (poiTier === "H4_CORE" && sc >= REWARDPROXY_MID_SC) ||
    (hasStack && sc >= REWARDPROXY_MID_SC)
  ) {
    return "MID";
  }

  return "LOW";
}

export function computePoiClusterKey(args: {
  entryBoundaryPrice: number;
  midPrice: number;
  tickSize: number;
}): string | null {
  const { entryBoundaryPrice, midPrice, tickSize } = args;

  if (
    !Number.isFinite(entryBoundaryPrice) ||
    !Number.isFinite(midPrice) ||
    !Number.isFinite(tickSize)
  ) {
    return null;
  }

  if (midPrice <= 0 || tickSize <= 0) {
    return null;
  }

  const clusterStepPrice = (midPrice * POI_CLUSTER_STEP_BPS) / 10000;
  const clusterStepTicks = Math.max(1, Math.round(clusterStepPrice / tickSize));
  const entryTicks = Math.round(entryBoundaryPrice / tickSize);

  return String(Math.floor(entryTicks / clusterStepTicks));
}
