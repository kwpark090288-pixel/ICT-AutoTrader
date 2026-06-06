import { uniqueLexicographicTags } from "../engine/tags";
import { buildEdgeSignatureKeys } from "../policy/gates/edge";
import { buildTradeReplayNote } from "../tradelifecycle/closeOutput";
import type { TradePlan } from "../tradelifecycle/types";
import type {
  PolicyResult,
  SignalCandidate,
} from "../policy/types";
import type {
  RouterCandidate,
  RouterOpenIntent,
  RouterOpenIntentPoiTier,
  RouterPolicyState,
  RouterSendClosePayload,
  RouterSendOpenPayload,
  RouterTf,
  RouterTradeDir,
} from "./types";

export function toRouterTradeDir(
  dir: SignalCandidate["dir"]
): RouterTradeDir {
  return dir === "BULL" ? "LONG" : "SHORT";
}

export function toRouterOpenIntentPoiTier(
  poiTier: SignalCandidate["poiTier"],
  tf: RouterTf
): RouterOpenIntentPoiTier {
  if (poiTier === "D1_POI") {
    return "D1_POI";
  }

  if (poiTier === "H4_CORE") {
    return "H4_CORE";
  }

  if (poiTier === "SETUP") {
    if (tf === "H1") {
      return "H1_SETUP";
    }

    if (tf === "M30") {
      return "M30_SETUP";
    }
  }

  return "OTHER";
}

export function toRouterPolicyState(
  policy: PolicyResult
): RouterPolicyState {
  if (
    policy.riskMode === "HALT" ||
    policy.derived.regimeState === "HALT"
  ) {
    return "HALT";
  }

  if (policy.derived.regimeState === "OK") {
    return "NORMAL";
  }

  return policy.derived.regimeState;
}

export function buildRouterPlanKey(
  symbol: string,
  dir: RouterTradeDir,
  poiId: string
): string {
  return `${symbol}|${dir}|${poiId}`;
}

export function buildRouterPlanId(
  planKey: string,
  openTime: string
): string {
  return `${planKey}@${openTime}`;
}

export function buildRouterOpenIntent(
  candidate: RouterCandidate
): RouterOpenIntent {
  const { signal, tf, policy } = candidate;
  const edgeSignatureKeys = buildEdgeSignatureKeys(
    signal,
    policy.derived.regimeState,
    policy.derived.liquidityState
  );

  return {
    symbol: signal.symbol,
    dir: toRouterTradeDir(signal.dir),
    eventType: signal.eventType,
    openTime: signal.time,
    source: signal.source,
    poiTier: toRouterOpenIntentPoiTier(signal.poiTier, tf),
    poiId: signal.poiId,
    tf,

    entryBoundaryPrice: signal.entryBoundaryPrice,
    hardInvalidationPrice: signal.hardInvalidationPrice,
    tags: uniqueLexicographicTags([
      ...(signal.tags ?? []),
      ...policy.policyTags,
    ]),

    policySnapshot: {
      decision: policy.decision,
      regimeState: toRouterPolicyState(policy),
      c_bps: policy.derived.c_bps_roundtrip,
      sc: policy.derived.SC,
    },

    score: candidate.score,
    collabStrength:
      candidate.collabStrength ??
      ((signal.collabStrength as RouterOpenIntent["collabStrength"]) ?? undefined),
    entryFillPrice: candidate.entryFillPrice,
    riskPctAtOpen: policy.suggestedRiskPct,
    poiClusterKey: policy.derived.poiClusterKey,
    edgeSigFine: edgeSignatureKeys.fine,
    edgeSigMid: edgeSignatureKeys.mid,
    edgeSigCoarse: edgeSignatureKeys.coarse,

    poiZoneBottom: candidate.poiZoneBottom,
    poiZoneTop: candidate.poiZoneTop,
  };
}

export function buildRouterSendOpenPayload(
  candidate: RouterCandidate
): RouterSendOpenPayload {
  const intent = buildRouterOpenIntent(candidate);
  const planKey = buildRouterPlanKey(intent.symbol, intent.dir, intent.poiId);
  const planId = buildRouterPlanId(planKey, intent.openTime);

  return {
    type: "SEND_OPEN",
    planKey,
    planId,
    intent,
  };
}

export function getRouterCloseSeverity(
  score?: number
): "HIGH" | "MID" | "LOW" {
  if (!Number.isFinite(score)) {
    return "MID";
  }

  if ((score as number) >= 90) {
    return "HIGH";
  }

  if ((score as number) >= 80) {
    return "MID";
  }

  return "LOW";
}

export function buildRouterSendCloseId(
  planId: string
): string {
  return `${planId}|CLOSE`;
}

function isRouterCloseTf(value: unknown): value is RouterTf {
  return (
    value === "D1" ||
    value === "H4" ||
    value === "H1" ||
    value === "M30" ||
    value === "M15" ||
    value === "M5"
  );
}

export function buildRouterSendClosePayload(
  plan: TradePlan
): RouterSendClosePayload {
  return {
    id: buildRouterSendCloseId(plan.planId),
    type: "SEND_CLOSE",
    symbol: plan.symbol,
    tf: plan.tf,
    time: plan.closeTime as string,
    direction: plan.dir,
    planId: plan.planId,
    exitTime: plan.closeTime as string,
    outcome: plan.outcome as RouterSendClosePayload["outcome"],
    exitPrice: plan.exitPrice as number,
    rGross: plan.rGross as number,

    mfeR: Number.isFinite(plan.mfeR) ? plan.mfeR : undefined,
    maeR: Number.isFinite(plan.maeR) ? plan.maeR : undefined,
    bothHit: typeof plan.bothHit === "boolean" ? plan.bothHit : undefined,
    weaknessCodes: plan.weaknessCodes,
    replayNote: buildTradeReplayNote(plan) ?? undefined,

    policyState: plan.policySnapshot?.regimeState,
    entryQuality: plan.entryQuality,
    collabStrength: plan.collabStrength,
    score: plan.score,
    severity: getRouterCloseSeverity(plan.score),
    poiRef: plan.poiId,
  };
}

export function hasRequiredRouterOpenIntentFields(
  intent: RouterOpenIntent
): boolean {
  return (
    typeof intent.symbol === "string" &&
    intent.symbol.length > 0 &&
    (intent.dir === "LONG" || intent.dir === "SHORT") &&
    (intent.eventType === "REACTION" ||
      intent.eventType === "ENTRY_WINDOW_OPEN") &&
    typeof intent.openTime === "string" &&
    intent.openTime.length > 0 &&
    typeof intent.source === "string" &&
    intent.source.length > 0 &&
    typeof intent.poiTier === "string" &&
    intent.poiTier.length > 0 &&
    typeof intent.poiId === "string" &&
    intent.poiId.length > 0 &&
    typeof intent.tf === "string" &&
    intent.tf.length > 0 &&
    Number.isFinite(intent.entryBoundaryPrice) &&
    Number.isFinite(intent.hardInvalidationPrice) &&
    Array.isArray(intent.tags) &&
    (intent.policySnapshot.decision === "ALLOW" ||
      intent.policySnapshot.decision === "BLOCK") &&
    (intent.policySnapshot.regimeState === "NORMAL" ||
      intent.policySnapshot.regimeState === "CAUTION" ||
      intent.policySnapshot.regimeState === "TRANSITION" ||
      intent.policySnapshot.regimeState === "HALT")
  );
}

export function hasRequiredRouterSendOpenPayloadFields(
  payload: RouterSendOpenPayload
): boolean {
  return (
    payload.type === "SEND_OPEN" &&
    typeof payload.planKey === "string" &&
    payload.planKey.length > 0 &&
    typeof payload.planId === "string" &&
    payload.planId.length > 0 &&
    hasRequiredRouterOpenIntentFields(payload.intent)
  );
}

export function hasRequiredRouterSendClosePayloadFields(
  payload: RouterSendClosePayload
): boolean {
  return (
    payload.type === "SEND_CLOSE" &&
    typeof payload.id === "string" &&
    payload.id.length > 0 &&
    typeof payload.symbol === "string" &&
    payload.symbol.length > 0 &&
    isRouterCloseTf(payload.tf) &&
    typeof payload.time === "string" &&
    payload.time.length > 0 &&
    (payload.direction === "LONG" || payload.direction === "SHORT") &&
    typeof payload.planId === "string" &&
    payload.planId.length > 0 &&
    typeof payload.exitTime === "string" &&
    payload.exitTime.length > 0 &&
    (payload.outcome === "HARD_TP" ||
      payload.outcome === "HARD_SL" ||
      payload.outcome === "SOFT_INVALID" ||
      payload.outcome === "TIMEOUT") &&
    Number.isFinite(payload.exitPrice) &&
    Number.isFinite(payload.rGross)
  );
}
