import { uniqueLexicographicTags } from "../engine/tags";
import {
  computeCostRoundtripBps,
  computeEntryRefPrice,
  computeExpectedRRUsed,
  computeFastMove,
  computePoiClusterKey,
  computeRewardBpsFromTpRefPrice,
  computeRewardProxy,
  computeSC,
  computeSEffectiveBps,
  computeSpreadBps,
  computeStopBufferBps,
  computeStopBufferPrice,
  computeSRawBps,
  computeSlippageMultiplier,
  estimateSlippageBpsP95,
} from "./derived";
import { evaluateConcentrationGate, isExceptionalSignal } from "./gates/concentration";
import { evaluateCostGate } from "./gates/cost";
import { evaluateDataIntegrityGate } from "./gates/dataIntegrity";
import { evaluateEdgeEvidenceGate } from "./gates/edge";
import { evaluatePortfolioExposureGate } from "./gates/portfolio";
import { evaluateRegimeGate } from "./gates/regime";
import { evaluateRewardProxyAdjust } from "./gates/rewardProxy";
import { evaluateRiskManager } from "./gates/risk";
import type {
  AccountSnapshot,
  ConcentrationHistoryItem,
  DerivedValues,
  EdgeSignatureStats,
  MarketSnapshot,
  PolicyResult,
  PolicyRiskMode,
  SignalCandidate,
} from "./types";

type EvaluatePolicyArgs = {
  signal: SignalCandidate;
  market: MarketSnapshot;
  account: AccountSnapshot;
  regimeLongAtr14BpsHistory: number[];
  regimeShortAtr14BpsHistory: number[];
  regimeLongVolumeM5History: number[];
  recentConcentrationHistory15m?: readonly ConcentrationHistoryItem[];
  fineStats?: EdgeSignatureStats | null;
  midStats?: EdgeSignatureStats | null;
  coarseStats?: EdgeSignatureStats | null;
  lastWinRAfterCost?: number | null;
  last2WinsRAfterCostSum?: number | null;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function normalizeMarketSnapshot(market: MarketSnapshot): MarketSnapshot {
  return {
    ...market,
    barChange_bps_m5: isFiniteNumber(market.barChange_bps_m5)
      ? market.barChange_bps_m5
      : market.dataOk
        ? 0
        : null,
  };
}

function hasRequiredSignalFields(signal: SignalCandidate): boolean {
  return (
    isNonEmptyString(signal.symbol) &&
    isNonEmptyString(signal.time) &&
    isNonEmptyString(signal.source) &&
    isNonEmptyString(signal.eventType) &&
    isNonEmptyString(signal.dir) &&
    isNonEmptyString(signal.poiTier) &&
    isNonEmptyString(signal.poiId) &&
    isFiniteNumber(signal.entryBoundaryPrice) &&
    isFiniteNumber(signal.hardInvalidationPrice) &&
    isFiniteNumber(signal.lastPrice) &&
    isFiniteNumber(signal.tickSize) &&
    signal.tickSize > 0 &&
    isFiniteNumber(signal.ltAtr14) &&
    signal.ltAtr14 > 0 &&
    (isFiniteNumber(signal.midPrice) || isFiniteNumber(signal.lastPrice))
  );
}

function hasRequiredMarketFields(market: MarketSnapshot): boolean {
  const hasBaseFields =
    isNonEmptyString(market.time) &&
    isNonEmptyString(market.symbol) &&
    isFiniteNumber(market.last) &&
    isFiniteNumber(market.mid) &&
    typeof market.dataOk === "boolean";

  if (!hasBaseFields) {
    return false;
  }

  if (market.dataOk === false) {
    return true;
  }

  return (
    isFiniteNumber(market.bid) &&
    isFiniteNumber(market.ask) &&
    isFiniteNumber(market.atr14_price) &&
    isFiniteNumber(market.atr14_bps) &&
    isFiniteNumber(market.volume_m5) &&
    isFiniteNumber(market.barChange_bps_m5)
  );
}

function hasRequiredAccountFields(account: AccountSnapshot): boolean {
  return (
    isNonEmptyString(account.time) &&
    isFiniteNumber(account.equity) &&
    isNonEmptyString(account.riskMode) &&
    isFiniteNumber(account.realizedPnl_24h_pct) &&
    isFiniteNumber(account.consecutiveLosses)
  );
}

function buildFallbackDerived(
  signal?: Partial<SignalCandidate>,
  market?: Partial<MarketSnapshot>
): DerivedValues {
  return {
    spread_bps: 0,
    fee_bps_roundtrip: 8,
    slippage_bps_p95_est: 1,
    slippage_multiplier: 1,
    c_bps_roundtrip: 9,
    entryRefPrice: isFiniteNumber(signal?.lastPrice) ? (signal?.lastPrice as number) : 0,
    s_raw_bps: 0,
    stopBuffer_price: 0,
    stopBuffer_bps: 0,
    s_effective_bps: 0,
    SC: 0,
    fastMove: false,
    atrRatio: 0,
    q95_short: 0,
    regimeState: "OK",
    volState: "NORMAL",
    liquidityState: "NORMAL",
    poiClusterKey: "",
    evidenceLevel: "NO_EVIDENCE",
    usedSignature: "NONE",
    lcbR: null,
    reward_bps: null,
    expectedRR_used: null,
    rewardProxy: "LOW",
    isExceptional: isExceptionalSignal({
      ...(signal as SignalCandidate),
      symbol: signal?.symbol ?? "",
      time: signal?.time ?? "",
      source: (signal?.source ?? "FVG") as SignalCandidate["source"],
      eventType: (signal?.eventType ?? "REACTION") as SignalCandidate["eventType"],
      dir: (signal?.dir ?? "BULL") as SignalCandidate["dir"],
      poiTier: (signal?.poiTier ?? "OTHER") as SignalCandidate["poiTier"],
      poiId: signal?.poiId ?? "",
      entryBoundaryPrice: signal?.entryBoundaryPrice ?? 0,
      hardInvalidationPrice: signal?.hardInvalidationPrice ?? 0,
      lastPrice: signal?.lastPrice ?? 0,
      midPrice: signal?.midPrice ?? 0,
      tickSize: signal?.tickSize ?? 0.1,
      ltAtr14: signal?.ltAtr14 ?? 1,
      triggerCount: signal?.triggerCount,
      collabStrength: signal?.collabStrength,
      hasStack: signal?.hasStack,
      tags: signal?.tags,
      expectedRR: signal?.expectedRR ?? null,
      tpRefPrice: signal?.tpRefPrice ?? null,
    }),
  };
}

function buildDerivedValues(args: {
  signal: SignalCandidate;
  market: MarketSnapshot;
  regimeState: DerivedValues["regimeState"];
  volState: DerivedValues["volState"];
  liquidityState: DerivedValues["liquidityState"];
  atrRatio: number;
  q95Short: number;
  evidenceLevel: DerivedValues["evidenceLevel"];
  usedSignature: DerivedValues["usedSignature"];
  lcbR: number | null;
}): DerivedValues | null {
  const {
    signal,
    market,
    regimeState,
    volState,
    liquidityState,
    atrRatio,
    q95Short,
    evidenceLevel,
    usedSignature,
    lcbR,
  } = args;

  const bid = market.bid as number;
  const ask = market.ask as number;
  const atr14Bps = market.atr14_bps as number;
  const barChangeBpsM5 = market.barChange_bps_m5 as number;

  const spreadBps = computeSpreadBps(bid, ask, market.mid);
  if (!isFiniteNumber(spreadBps)) return null;

  const slippageBpsP95Est = estimateSlippageBpsP95(spreadBps);
  if (!isFiniteNumber(slippageBpsP95Est)) return null;

  const fastMove = computeFastMove(
    barChangeBpsM5,
    atr14Bps
  );

  const entryRefPrice = computeEntryRefPrice(signal.midPrice, signal.lastPrice);
  if (!isFiniteNumber(entryRefPrice) || entryRefPrice <= 0) return null;

  const slippageMultiplier = computeSlippageMultiplier({
    liquidityState,
    regimeState,
    fastMove,
  });

  const cBpsRoundtrip = computeCostRoundtripBps({
    spreadBps,
    slippageBpsP95: slippageBpsP95Est,
    slippageMultiplier,
  });
  if (!isFiniteNumber(cBpsRoundtrip)) return null;

  const stopBufferPrice = computeStopBufferPrice(
    signal.tickSize,
    signal.ltAtr14,
    volState
  );
  if (!isFiniteNumber(stopBufferPrice)) return null;

  const sRawBps = computeSRawBps(entryRefPrice, signal.hardInvalidationPrice);
  if (!isFiniteNumber(sRawBps)) return null;

  const stopBufferBps = computeStopBufferBps(entryRefPrice, stopBufferPrice);
  if (!isFiniteNumber(stopBufferBps)) return null;

  const sEffectiveBps = computeSEffectiveBps(sRawBps, stopBufferBps);
  if (!isFiniteNumber(sEffectiveBps)) return null;

  const SC = computeSC(sEffectiveBps, cBpsRoundtrip);
  if (!isFiniteNumber(SC)) return null;

  const rewardBps = isFiniteNumber(signal.tpRefPrice)
    ? computeRewardBpsFromTpRefPrice(entryRefPrice, signal.tpRefPrice as number)
    : null;

  const expectedRRUsed = computeExpectedRRUsed({
    expectedRR: signal.expectedRR ?? null,
    tpRefPrice: signal.tpRefPrice ?? null,
    entryRefPrice,
    sEffectiveBps,
  });

  const rewardProxy = computeRewardProxy({
    poiTier: signal.poiTier,
    hasStack: signal.hasStack ?? false,
    sc: SC,
  });

  const poiClusterKey =
    computePoiClusterKey({
      entryBoundaryPrice: signal.entryBoundaryPrice,
      midPrice: isFiniteNumber(signal.midPrice) ? signal.midPrice : signal.lastPrice,
      tickSize: signal.tickSize,
    }) ?? "";

  return {
    spread_bps: spreadBps,
    fee_bps_roundtrip: 8,
    slippage_bps_p95_est: slippageBpsP95Est,
    slippage_multiplier: slippageMultiplier,
    c_bps_roundtrip: cBpsRoundtrip,
    entryRefPrice,
    s_raw_bps: sRawBps,
    stopBuffer_price: stopBufferPrice,
    stopBuffer_bps: stopBufferBps,
    s_effective_bps: sEffectiveBps,
    SC,
    fastMove,
    atrRatio,
    q95_short: q95Short,
    regimeState,
    volState,
    liquidityState,
    poiClusterKey,
    evidenceLevel,
    usedSignature,
    lcbR,
    reward_bps: rewardBps ?? null,
    expectedRR_used: expectedRRUsed ?? null,
    rewardProxy,
    isExceptional: isExceptionalSignal(signal),
  };
}

function finalizePolicyResult(args: {
  decision: PolicyResult["decision"];
  policyScoreDeltaSum: number;
  policyTags: string[];
  reasons: string[];
  riskMode: PolicyRiskMode;
  suggestedRiskPct: number;
  derived: DerivedValues;
}): PolicyResult {
  return {
    decision: args.decision,
    policyScoreDeltaSum: args.policyScoreDeltaSum,
    policyTags: uniqueLexicographicTags(args.policyTags),
    reasons: uniqueLexicographicTags(args.reasons),
    riskMode: args.riskMode,
    suggestedRiskPct: args.suggestedRiskPct,
    derived: args.derived,
  };
}

export function evaluatePolicy(
  args: EvaluatePolicyArgs
): PolicyResult | null {
  const {
    signal,
    market,
    account,
    regimeLongAtr14BpsHistory,
    regimeShortAtr14BpsHistory,
    regimeLongVolumeM5History,
    recentConcentrationHistory15m = [],
    fineStats = null,
    midStats = null,
    coarseStats = null,
    lastWinRAfterCost = null,
    last2WinsRAfterCostSum = null,
  } = args;

  const normalizedMarket = normalizeMarketSnapshot(market);

  if (
    !hasRequiredSignalFields(signal) ||
    !hasRequiredMarketFields(normalizedMarket) ||
    !hasRequiredAccountFields(account)
  ) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum: 0,
      policyTags: [],
      reasons: ["missing_required_field"],
      riskMode: isNonEmptyString(account?.riskMode)
        ? (account.riskMode as PolicyRiskMode)
        : "NORMAL",
      suggestedRiskPct: 0,
      derived: buildFallbackDerived(signal, normalizedMarket),
    });
  }

  const dataIntegrity = evaluateDataIntegrityGate(normalizedMarket);
  if (!dataIntegrity) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum: 0,
      policyTags: [],
      reasons: ["missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: buildFallbackDerived(signal, normalizedMarket),
    });
  }

  if (dataIntegrity.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum: 0,
      policyTags: dataIntegrity.tags,
      reasons: dataIntegrity.reasons,
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: buildFallbackDerived(signal, normalizedMarket),
    });
  }

  const marketBid = normalizedMarket.bid as number;
  const marketAsk = normalizedMarket.ask as number;
  const marketAtr14Bps = normalizedMarket.atr14_bps as number;
  const marketVolumeM5 = normalizedMarket.volume_m5 as number;

  const regimeEval = evaluateRegimeGate({
    spreadBps: computeSpreadBps(
      marketBid,
      marketAsk,
      normalizedMarket.mid
    ) as number,
    atr14BpsNow: marketAtr14Bps,
    volumeM5: marketVolumeM5,
    longAtr14BpsHistory: regimeLongAtr14BpsHistory,
    shortAtr14BpsHistory: regimeShortAtr14BpsHistory,
    longVolumeM5History: regimeLongVolumeM5History,
  });

  if (!regimeEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum: 0,
      policyTags: [],
      reasons: ["missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: buildFallbackDerived(signal, normalizedMarket),
    });
  }

  const coreDerived = buildDerivedValues({
    signal,
    market: normalizedMarket,
    regimeState: regimeEval.regimeState,
    volState: regimeEval.volState,
    liquidityState: regimeEval.liquidityState,
    atrRatio: regimeEval.atrRatio,
    q95Short: regimeEval.q95Short,
    evidenceLevel: "NO_EVIDENCE",
    usedSignature: "NONE",
    lcbR: null,
  });

  if (!coreDerived) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum: 0,
      policyTags: [],
      reasons: ["missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: buildFallbackDerived(signal, normalizedMarket),
    });
  }

  let policyScoreDeltaSum = regimeEval.scoreDelta;
  const policyTags = [...regimeEval.tags];
  const reasons = [...regimeEval.reasons];

  if (regimeEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  const costEval = evaluateCostGate(coreDerived.SC);
  if (!costEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  policyScoreDeltaSum += costEval.scoreDelta;
  policyTags.push(...costEval.tags.filter((tag) => tag !== "SC_GOOD"));
  reasons.push(...costEval.reasons);

  if (costEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  const rewardEval = evaluateRewardProxyAdjust({
    expectedRRUsed: coreDerived.expectedRR_used,
    rewardProxy: coreDerived.rewardProxy,
  });

  if (!rewardEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  policyScoreDeltaSum += rewardEval.scoreDelta;
  policyTags.push(...rewardEval.tags);

  const concentrationEval = evaluateConcentrationGate({
    signal,
    poiClusterKey: coreDerived.poiClusterKey || null,
    recentHistory15m: recentConcentrationHistory15m,
  });

  if (!concentrationEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  policyScoreDeltaSum += concentrationEval.scoreDelta;
  policyTags.push(...concentrationEval.tags);
  reasons.push(...concentrationEval.reasons);

  if (concentrationEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  const edgeEval = evaluateEdgeEvidenceGate({
    signal,
    regimeState: regimeEval.regimeState,
    liquidityState: regimeEval.liquidityState,
    sc: coreDerived.SC,
    isExceptional: coreDerived.isExceptional,
    fineStats,
    midStats,
    coarseStats,
  });

  if (!edgeEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: coreDerived,
    });
  }

  policyScoreDeltaSum += edgeEval.scoreDelta;
  policyTags.push(...edgeEval.tags);
  reasons.push(...edgeEval.reasons);

  const derivedWithEdge: DerivedValues = {
    ...coreDerived,
    evidenceLevel: edgeEval.evidenceLevel,
    usedSignature: edgeEval.usedSignature,
    lcbR: edgeEval.lcbR,
  };

  if (edgeEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: derivedWithEdge,
    });
  }

  const riskEval = evaluateRiskManager({
    account,
    evidenceLevel: edgeEval.evidenceLevel,
    lastWinRAfterCost,
    last2WinsRAfterCostSum,
  });

  if (!riskEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: account.riskMode,
      suggestedRiskPct: 0,
      derived: derivedWithEdge,
    });
  }

  policyScoreDeltaSum += riskEval.scoreDelta;
  policyTags.push(...riskEval.tags);
  reasons.push(...riskEval.reasons);

  if (riskEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: riskEval.riskMode,
      suggestedRiskPct: 0,
      derived: derivedWithEdge,
    });
  }

  const portfolioEval = evaluatePortfolioExposureGate({
    account,
    riskMode: riskEval.riskMode,
    suggestedRiskPct: riskEval.suggestedRiskPct,
  });

  if (!portfolioEval) {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons: [...reasons, "missing_required_field"],
      riskMode: riskEval.riskMode,
      suggestedRiskPct: 0,
      derived: derivedWithEdge,
    });
  }

  policyScoreDeltaSum += portfolioEval.scoreDelta;
  policyTags.push(...portfolioEval.tags);
  reasons.push(...portfolioEval.reasons);

  if (portfolioEval.decision === "BLOCK") {
    return finalizePolicyResult({
      decision: "BLOCK",
      policyScoreDeltaSum,
      policyTags,
      reasons,
      riskMode: riskEval.riskMode,
      suggestedRiskPct: portfolioEval.suggestedRiskPct,
      derived: derivedWithEdge,
    });
  }

  return finalizePolicyResult({
    decision: "ALLOW",
    policyScoreDeltaSum,
    policyTags,
    reasons,
    riskMode: riskEval.riskMode,
    suggestedRiskPct: portfolioEval.suggestedRiskPct,
    derived: derivedWithEdge,
  });
}
