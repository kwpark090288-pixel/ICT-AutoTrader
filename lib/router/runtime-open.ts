import { getCachedTickSize } from "../engine/ticksize";
import {
  getMarketAtr14AtCloseTime,
  getMarketAtr14AtOrBeforeCloseTime,
  getMarketBars,
  listConfirmedFractalPivotsBeforeCloseTime,
} from "../engine/market-context";
import type { Bar, Pivot } from "../engine/types";
import {
  W_LONG_BARS,
  W_SHORT_BARS,
} from "../policy/constants";
import { buildEdgeSignatureKeys } from "../policy/gates/edge";
import { evaluatePolicy } from "../policy/policy";
import { buildRuntimeAlertOnlyAccountSnapshot, buildRuntimeMarketSnapshot, type RuntimePolicySyncState } from "../policy/runtime-input";
import {
  loadRuntimePolicyDbState,
  upsertPolicyAccountRiskMode,
} from "../policy/runtime-state";
import type {
  AccountSnapshot,
  ConcentrationHistoryItem,
  EdgeSignatureStats,
  MarketSnapshot,
  PolicyResult,
  SignalCandidate,
} from "../policy/types";
import {
  buildPolicySignalCandidateFromSeedViaDraft,
  mapRouterPoiTier,
  type RouterPolicySignalCandidateDraftContext,
} from "./candidate";
import {
  toRouterOpenIntentPoiTier,
} from "./contracts";
import type {
  RouterCandidate,
  RouterCollabStrength,
  RouterTf,
} from "./types";
import type { RouterRawDir, RouterRawSignalCandidate } from "./raw-event";
import { getTpLiqTf } from "../tradelifecycle/open";

function isFinitePositive(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function toRouterTf(value: string): RouterTf | null {
  return value === "D1" ||
    value === "H4" ||
    value === "H1" ||
    value === "M30" ||
    value === "M15" ||
    value === "M5"
    ? value
    : null;
}

function computeAtrBps(atr14Price: number, closePrice: number): number | null {
  if (!isFinitePositive(atr14Price) || !isFinitePositive(closePrice)) {
    return null;
  }

  return (atr14Price / closePrice) * 10_000;
}

function buildRuntimeRegimeHistories(symbol: string, openTimeMs: number): {
  regimeLongAtr14BpsHistory: number[];
  regimeShortAtr14BpsHistory: number[];
  regimeLongVolumeM5History: number[];
} {
  const bars = getMarketBars(symbol, "M5").filter((bar) => bar.closeTime <= openTimeMs);
  const atrBpsHistory = bars
    .map((bar) => {
      const atr14Price = getMarketAtr14AtCloseTime(symbol, "M5", bar.closeTime);
      return Number.isFinite(atr14Price)
        ? computeAtrBps(atr14Price as number, bar.close)
        : null;
    })
    .filter((value): value is number => Number.isFinite(value));

  return {
    regimeLongAtr14BpsHistory: atrBpsHistory.slice(-W_LONG_BARS),
    regimeShortAtr14BpsHistory: atrBpsHistory.slice(-W_SHORT_BARS),
    regimeLongVolumeM5History: bars
      .map((bar) => bar.volume)
      .filter((value) => Number.isFinite(value))
      .slice(-W_LONG_BARS),
  };
}

export interface RuntimePolicyEvaluationBridge {
  signal: SignalCandidate;
  market: MarketSnapshot;
  account: AccountSnapshot;
  tickSize: number;
  atrLiq14AtOpen: number;
  confirmedTpPivots: readonly Pivot[];
  regimeLongAtr14BpsHistory: number[];
  regimeShortAtr14BpsHistory: number[];
  regimeLongVolumeM5History: number[];
  fineStats: EdgeSignatureStats | null;
  midStats: EdgeSignatureStats | null;
  coarseStats: EdgeSignatureStats | null;
}

export function buildRuntimePolicyEvaluationBridgeFromSeed(args: {
  seed: RouterRawSignalCandidate;
  syncState?: RuntimePolicySyncState | null;
}): RuntimePolicyEvaluationBridge | null {
  const { seed, syncState } = args;
  const tickSize = getCachedTickSize(seed.symbol);
  const openTimeMs = Date.parse(seed.openTime);
  const lastPrice = seed.barSnapshot?.close;
  const market = buildRuntimeMarketSnapshot({
    symbol: seed.symbol,
    openTime: seed.openTime,
    lastPrice: Number.isFinite(lastPrice) ? (lastPrice as number) : seed.entryRefPrice,
    syncState,
  });
  const account = buildRuntimeAlertOnlyAccountSnapshot({
    openTime: seed.openTime,
  });

  if (
    !market ||
    !account ||
    !isFinitePositive(tickSize) ||
    !Number.isFinite(openTimeMs)
  ) {
    return null;
  }

  const ltAtrTf = seed.ltf;
  const ltAtr14 = getMarketAtr14AtOrBeforeCloseTime(seed.symbol, ltAtrTf, openTimeMs);
  if (!isFinitePositive(ltAtr14)) {
    return null;
  }

  const poiTier = mapRouterPoiTier(seed);
  const tf = toRouterTf(seed.poiTf);
  if (!tf) {
    return null;
  }

  const tpLiqTf = getTpLiqTf(toRouterOpenIntentPoiTier(poiTier, tf));
  const atrLiq14 = getMarketAtr14AtOrBeforeCloseTime(seed.symbol, tpLiqTf, openTimeMs);
  if (!isFinitePositive(atrLiq14)) {
    return null;
  }

  const confirmedTpPivots: readonly Pivot[] =
    listConfirmedFractalPivotsBeforeCloseTime(seed.symbol, tpLiqTf, openTimeMs);

  const signal = buildPolicySignalCandidateFromSeedViaDraft(seed, {
    lastPrice: market.last,
    midPrice: market.mid,
    tickSize,
    ltAtr14,
    atrLiq_14_atOpen: atrLiq14,
    confirmedTpPivots,
  } satisfies RouterPolicySignalCandidateDraftContext);

  if (!signal) {
    return null;
  }

  const histories = buildRuntimeRegimeHistories(seed.symbol, openTimeMs);

  return {
    signal,
    market,
    account,
    tickSize,
    atrLiq14AtOpen: atrLiq14,
    confirmedTpPivots,
    ...histories,
    fineStats: null,
    midStats: null,
    coarseStats: null,
  };
}

export function buildRuntimePolicyResultFromSeed(args: {
  seed: RouterRawSignalCandidate;
  syncState?: RuntimePolicySyncState | null;
  recentConcentrationHistory15m?: readonly ConcentrationHistoryItem[];
}): {
  seed: RouterRawSignalCandidate;
  signal: SignalCandidate;
  market: MarketSnapshot;
  account: AccountSnapshot;
  policy: PolicyResult;
  tickSize: number;
  atrLiq14AtOpen: number;
  confirmedTpPivots: readonly Pivot[];
} | null {
  const bridge = buildRuntimePolicyEvaluationBridgeFromSeed(args);
  if (!bridge) {
    return null;
  }

  const policy = evaluatePolicy({
    signal: bridge.signal,
    market: bridge.market,
    account: bridge.account,
    regimeLongAtr14BpsHistory: bridge.regimeLongAtr14BpsHistory,
    regimeShortAtr14BpsHistory: bridge.regimeShortAtr14BpsHistory,
    regimeLongVolumeM5History: bridge.regimeLongVolumeM5History,
    recentConcentrationHistory15m: args.recentConcentrationHistory15m,
    fineStats: bridge.fineStats,
    midStats: bridge.midStats,
    coarseStats: bridge.coarseStats,
  });

  if (!policy) {
    return null;
  }

  return {
    seed: args.seed,
    signal: bridge.signal,
    market: bridge.market,
    account: bridge.account,
    policy,
    tickSize: bridge.tickSize,
    atrLiq14AtOpen: bridge.atrLiq14AtOpen,
    confirmedTpPivots: bridge.confirmedTpPivots,
  };
}

export async function buildDbBackedRuntimePolicyResultFromSeed(args: {
  seed: RouterRawSignalCandidate;
  syncState?: RuntimePolicySyncState | null;
}): Promise<{
  seed: RouterRawSignalCandidate;
  signal: SignalCandidate;
  market: MarketSnapshot;
  account: AccountSnapshot;
  policy: PolicyResult;
  tickSize: number;
  atrLiq14AtOpen: number;
  confirmedTpPivots: readonly Pivot[];
} | null> {
  const bridge = buildRuntimePolicyEvaluationBridgeFromSeed(args);
  if (!bridge) {
    return null;
  }

  const previewPolicy = evaluatePolicy({
    signal: bridge.signal,
    market: bridge.market,
    account: bridge.account,
    regimeLongAtr14BpsHistory: bridge.regimeLongAtr14BpsHistory,
    regimeShortAtr14BpsHistory: bridge.regimeShortAtr14BpsHistory,
    regimeLongVolumeM5History: bridge.regimeLongVolumeM5History,
    recentConcentrationHistory15m: [],
    fineStats: null,
    midStats: null,
    coarseStats: null,
  });

  if (!previewPolicy) {
    return null;
  }

  const edgeSignatureKeys = buildEdgeSignatureKeys(
    bridge.signal,
    previewPolicy.derived.regimeState,
    previewPolicy.derived.liquidityState
  );

  const runtimeState = await loadRuntimePolicyDbState({
    signal: bridge.signal,
    edgeSignatureKeys,
  });

  if (!runtimeState) {
    return null;
  }

  const policy = evaluatePolicy({
    signal: bridge.signal,
    market: bridge.market,
    account: runtimeState.account,
    regimeLongAtr14BpsHistory: bridge.regimeLongAtr14BpsHistory,
    regimeShortAtr14BpsHistory: bridge.regimeShortAtr14BpsHistory,
    regimeLongVolumeM5History: bridge.regimeLongVolumeM5History,
    recentConcentrationHistory15m: runtimeState.recentConcentrationHistory15m,
    fineStats: runtimeState.fineStats,
    midStats: runtimeState.midStats,
    coarseStats: runtimeState.coarseStats,
    lastWinRAfterCost: runtimeState.lastWinRAfterCost,
    last2WinsRAfterCostSum: runtimeState.last2WinsRAfterCostSum,
  });

  if (!policy) {
    return null;
  }

  if (policy.riskMode !== runtimeState.storedRiskMode) {
    await upsertPolicyAccountRiskMode({
      nextRiskMode: policy.riskMode,
      updatedAtUtc: bridge.signal.time,
      lastTransitionReason: "POLICY_EVAL",
    });
  }

  return {
    seed: args.seed,
    signal: bridge.signal,
    market: bridge.market,
    account: runtimeState.account,
    policy,
    tickSize: bridge.tickSize,
    atrLiq14AtOpen: bridge.atrLiq14AtOpen,
    confirmedTpPivots: bridge.confirmedTpPivots,
  };
}

function resolveRuntimeRouterCandidateTf(seed: RouterRawSignalCandidate): RouterTf | null {
  return toRouterTf(seed.poiTf);
}

function resolveRuntimeRouterPoiConfTime(seed: RouterRawSignalCandidate): string {
  return typeof seed.poiSnapshot?.confTime === "string" ? seed.poiSnapshot.confTime : "";
}

function resolveRuntimeRouterPriceExtreme(
  dir: RouterRawDir,
  emissionBar: Pick<Bar, "low" | "high">
): number | null {
  if (dir === "BULL" && Number.isFinite(emissionBar.low)) {
    return emissionBar.low;
  }

  if (dir === "BEAR" && Number.isFinite(emissionBar.high)) {
    return emissionBar.high;
  }

  return null;
}

function toRouterRuntimeCollabStrength(
  collabStrength?: SignalCandidate["collabStrength"]
): RouterCollabStrength | undefined {
  if (
    collabStrength === "NONE" ||
    collabStrength === "WEAK" ||
    collabStrength === "STRONG"
  ) {
    return collabStrength;
  }

  return undefined;
}

export function buildRuntimeRouterCandidate(args: {
  seed: RouterRawSignalCandidate;
  signal: SignalCandidate;
  policy: PolicyResult;
  emissionBar: Pick<Bar, "high" | "low">;
}): RouterCandidate | null {
  const tf = resolveRuntimeRouterCandidateTf(args.seed);
  const priceExtreme = resolveRuntimeRouterPriceExtreme(args.seed.dir, args.emissionBar);

  if (!tf || !Number.isFinite(priceExtreme)) {
    return null;
  }

  return {
    signal: args.signal,
    tf,
    policy: args.policy,
    priceExtreme: priceExtreme as number,
    poiConfTime: resolveRuntimeRouterPoiConfTime(args.seed),
    collabStrength: toRouterRuntimeCollabStrength(args.signal.collabStrength),
  };
}

export function getRuntimePreviousM5CloseTimeIso(
  symbol: string,
  openTime: string
): string | null {
  const openTimeMs = Date.parse(openTime);
  if (!Number.isFinite(openTimeMs)) {
    return null;
  }

  const bars = getMarketBars(symbol, "M5").filter((bar) => bar.closeTime < openTimeMs);
  const prev = bars[bars.length - 1];
  return prev ? new Date(prev.closeTime).toISOString().replace(".000Z", "Z") : null;
}
