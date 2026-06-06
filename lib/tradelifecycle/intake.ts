import type { RouterSendOpenPayload } from "../router/types";
import {
  M5_INTERVAL_MS,
  TRADE_TICK_EPSILON_FACTOR,
} from "./constants";
import type {
  TradeActivePlanRef,
  TradeOpenSuppressionEvalResult,
} from "./types";

export function parseIsoUtcMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isContinuousM5Close(
  prevCloseTime?: string | null,
  currCloseTime?: string | null
): boolean {
  if (!prevCloseTime) {
    return true;
  }

  if (!currCloseTime) {
    return false;
  }

  const prevMs = parseIsoUtcMs(prevCloseTime);
  const currMs = parseIsoUtcMs(currCloseTime);

  if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) {
    return false;
  }

  const delta = (currMs as number) - (prevMs as number);

  if (delta <= 0) {
    return false;
  }

  return delta === M5_INTERVAL_MS;
}

export function buildTradeZoneKey(
  payload: RouterSendOpenPayload,
  tickSize: number
): string | null {
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  const { intent } = payload;

  const rawBottom =
    Number.isFinite(intent.poiZoneBottom) && Number.isFinite(intent.poiZoneTop)
      ? (intent.poiZoneBottom as number)
      : Math.min(intent.entryBoundaryPrice, intent.hardInvalidationPrice);

  const rawTop =
    Number.isFinite(intent.poiZoneBottom) && Number.isFinite(intent.poiZoneTop)
      ? (intent.poiZoneTop as number)
      : Math.max(intent.entryBoundaryPrice, intent.hardInvalidationPrice);

  if (!Number.isFinite(rawBottom) || !Number.isFinite(rawTop)) {
    return null;
  }

  const eps = tickSize * TRADE_TICK_EPSILON_FACTOR;
  const bottomTick = Math.floor((rawBottom + eps) / tickSize);
  const topTick = Math.ceil((rawTop - eps) / tickSize);

  return `${intent.symbol}|${intent.dir}|${bottomTick}~${topTick}`;
}

export function hasDuplicateActiveZone(
  payload: RouterSendOpenPayload,
  zoneKey: string,
  activePlans: readonly TradeActivePlanRef[]
): boolean {
  return activePlans.some(
    (plan) =>
      plan.symbol === payload.intent.symbol &&
      plan.dir === payload.intent.dir &&
      (plan.status === "OPEN" || plan.status === "CLOSING") &&
      plan.zoneKey === zoneKey
  );
}

type EvaluateTradeOpenSuppressionArgs = {
  payload: RouterSendOpenPayload;
  tickSize: number;
  prevM5CloseTime?: string | null;
  currM5CloseTime: string;
  activePlans: readonly TradeActivePlanRef[];
};

export function evaluateTradeOpenSuppression(
  args: EvaluateTradeOpenSuppressionArgs
): TradeOpenSuppressionEvalResult {
  const {
    payload,
    tickSize,
    prevM5CloseTime,
    currM5CloseTime,
    activePlans,
  } = args;

  const planKey = payload.planKey;
  const planId = payload.planId;
  const zoneKey = buildTradeZoneKey(payload, tickSize);

  if (!zoneKey) {
    return {
      decision: "SUPPRESS",
      reason: "INVALID_INPUT",
      planKey,
      planId,
      zoneKey: "",
    };
  }

  if (!isContinuousM5Close(prevM5CloseTime, currM5CloseTime)) {
    return {
      decision: "SUPPRESS",
      reason: "DATA_GAP",
      planKey,
      planId,
      zoneKey,
    };
  }

  if (hasDuplicateActiveZone(payload, zoneKey, activePlans)) {
    return {
      decision: "SUPPRESS",
      reason: "DEDUP_ZONE",
      planKey,
      planId,
      zoneKey,
    };
  }

  return {
    decision: "ALLOW",
    reason: null,
    planKey,
    planId,
    zoneKey,
  };
}
