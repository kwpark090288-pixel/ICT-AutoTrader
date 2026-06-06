import { TRADE_MONITOR_TF } from "./constants";
import type {
  TradeCloseOutcome,
  TradeHitEvalResult,
  TradePlan,
} from "./types";
import type { Bar } from "../engine/types";

function parseIsoUtcMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function toUtcMs(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  return parseIsoUtcMs(value);
}

export function roundToTick(
  value: number,
  tickSize: number
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return null;
  }

  return Number(
    (Math.round((value as number) / tickSize) * tickSize).toFixed(12)
  );
}

export function isTradeMonitorTf(tf: string): boolean {
  return tf === TRADE_MONITOR_TF;
}

export function shouldEvaluateTradeMonitorBar(
  plan: Pick<TradePlan, "openTime">,
  barCloseTime: string | number
): boolean {
  const openTimeMs = parseIsoUtcMs(plan.openTime);
  const barCloseTimeMs = toUtcMs(barCloseTime);

  if (!Number.isFinite(openTimeMs) || !Number.isFinite(barCloseTimeMs)) {
    return false;
  }

  return (barCloseTimeMs as number) > (openTimeMs as number);
}

export function evaluateTradeTimeoutHit(
  plan: Pick<TradePlan, "timeoutDueTime">,
  barCloseTime: string | number
): boolean {
  const timeoutDueTimeMs = parseIsoUtcMs(plan.timeoutDueTime);
  const barCloseTimeMs = toUtcMs(barCloseTime);

  if (!Number.isFinite(timeoutDueTimeMs) || !Number.isFinite(barCloseTimeMs)) {
    return false;
  }

  return (barCloseTimeMs as number) >= (timeoutDueTimeMs as number);
}

export function resolveTradeCloseOutcome(args: {
  slHit: boolean;
  tpHit: boolean;
  softInvalid: boolean;
  timeoutHit: boolean;
}): TradeCloseOutcome | null {
  const { slHit, tpHit, softInvalid, timeoutHit } = args;

  if (slHit) {
    return "HARD_SL";
  }

  if (tpHit) {
    return "HARD_TP";
  }

  if (softInvalid) {
    return "SOFT_INVALID";
  }

  if (timeoutHit) {
    return "TIMEOUT";
  }

  return null;
}

export function resolveTradeExitPrice(
  plan: Pick<TradePlan, "stopPrice" | "tpPrice">,
  bar: Pick<Bar, "close">,
  outcome: TradeCloseOutcome | null,
  tickSize: number
): number | null {
  if (!outcome) {
    return null;
  }

  if (outcome === "HARD_SL") {
    return Number.isFinite(plan.stopPrice) ? plan.stopPrice : null;
  }

  if (outcome === "HARD_TP") {
    return Number.isFinite(plan.tpPrice) ? plan.tpPrice : null;
  }

  if (outcome === "SOFT_INVALID" || outcome === "TIMEOUT") {
    return roundToTick(bar.close, tickSize);
  }

  return null;
}

function toIsoUtcString(value: number): string | null {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

type ApplyTradeMonitorOnBarArgs = {
  plan: TradePlan;
  bar: Bar;
  tickSize: number;
  invalidTime?: string | null;
};

export function applyTradeMonitorOnBar(
  args: ApplyTradeMonitorOnBarArgs
): TradePlan {
  const {
    plan,
    bar,
    tickSize,
    invalidTime = null,
  } = args;

  if (!isTradeMonitorTf(bar.tf)) {
    return plan;
  }

  if (plan.status !== "OPEN") {
    return plan;
  }

  if (!shouldEvaluateTradeMonitorBar(plan, bar.closeTime)) {
    return plan;
  }

  const favR = computeTradeFavR(plan, bar);
  const advR = computeTradeAdvR(plan, bar);

  const nextMfeR = Number.isFinite(favR)
    ? Math.max(plan.mfeR, favR as number)
    : plan.mfeR;
  const nextMaeR = Number.isFinite(advR)
    ? Math.max(plan.maeR, advR as number)
    : plan.maeR;

  const hitEval = evaluateTradeHardTpSlHit(plan, bar);
  const softInvalid = evaluateTradeSoftInvalid(
    plan,
    bar,
    tickSize,
    invalidTime
  );
  const timeoutHit = evaluateTradeTimeoutHit(plan, bar.closeTime);

  const outcome = resolveTradeCloseOutcome({
    slHit: hitEval?.slHit ?? false,
    tpHit: hitEval?.tpHit ?? false,
    softInvalid,
    timeoutHit,
  });

  if (!outcome) {
    return {
      ...plan,
      mfeR: nextMfeR,
      maeR: nextMaeR,
    };
  }

  const exitPrice = resolveTradeExitPrice(plan, bar, outcome, tickSize);
  const closeTime = toIsoUtcString(bar.closeTime);

  return {
    ...plan,
    status: "CLOSED",
    outcome,
    closeTime: closeTime ?? plan.closeTime,
    exitPrice: exitPrice ?? plan.exitPrice,
    bothHit: hitEval?.bothHit ?? false,
    mfeR: nextMfeR,
    maeR: nextMaeR,
  };
}

function getRiskUnit(
  plan: Pick<TradePlan, "entryRefPrice" | "stopPrice">
): number | null {
  const s = Math.abs(plan.entryRefPrice - plan.stopPrice);
  return Number.isFinite(s) && s > 0 ? s : null;
}

export function computeTradeFavR(
  plan: Pick<TradePlan, "dir" | "entryRefPrice" | "stopPrice">,
  bar: Pick<Bar, "high" | "low">
): number | null {
  const s = getRiskUnit(plan);

  if (
    (plan.dir !== "LONG" && plan.dir !== "SHORT") ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(s)
  ) {
    return null;
  }

  return plan.dir === "LONG"
    ? (bar.high - plan.entryRefPrice) / (s as number)
    : (plan.entryRefPrice - bar.low) / (s as number);
}

export function computeTradeAdvR(
  plan: Pick<TradePlan, "dir" | "entryRefPrice" | "stopPrice">,
  bar: Pick<Bar, "high" | "low">
): number | null {
  const s = getRiskUnit(plan);

  if (
    (plan.dir !== "LONG" && plan.dir !== "SHORT") ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(s)
  ) {
    return null;
  }

  return plan.dir === "LONG"
    ? (plan.entryRefPrice - bar.low) / (s as number)
    : (bar.high - plan.entryRefPrice) / (s as number);
}

export function evaluateTradeHardTpSlHit(
  plan: Pick<TradePlan, "dir" | "stopPrice" | "tpPrice">,
  bar: Pick<Bar, "high" | "low">
): TradeHitEvalResult | null {
  if (
    (plan.dir !== "LONG" && plan.dir !== "SHORT") ||
    !Number.isFinite(plan.stopPrice) ||
    !Number.isFinite(plan.tpPrice) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low)
  ) {
    return null;
  }

  const slHit =
    plan.dir === "LONG"
      ? bar.low <= plan.stopPrice
      : bar.high >= plan.stopPrice;

  const tpHit =
    plan.dir === "LONG"
      ? bar.high >= plan.tpPrice
      : bar.low <= plan.tpPrice;

  return {
    slHit,
    tpHit,
    bothHit: slHit && tpHit,
  };
}

export function evaluateTradeSoftInvalid(
  plan: Pick<TradePlan, "dir" | "hardInvalidationPrice" | "openTime">,
  bar: Pick<Bar, "close" | "closeTime">,
  tickSize: number,
  invalidTime?: string | null
): boolean {
  if (
    (plan.dir !== "LONG" && plan.dir !== "SHORT") ||
    !Number.isFinite(plan.hardInvalidationPrice) ||
    !Number.isFinite(bar.close) ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0
  ) {
    return false;
  }

  const conditionA =
    plan.dir === "LONG"
      ? bar.close <= plan.hardInvalidationPrice - tickSize
      : bar.close >= plan.hardInvalidationPrice + tickSize;

  if (!isNonEmptyString(invalidTime)) {
    return conditionA;
  }

  const openTimeMs = parseIsoUtcMs(plan.openTime);
  const barCloseTimeMs = Number.isFinite(bar.closeTime) ? bar.closeTime : null;
  const invalidTimeMs = parseIsoUtcMs(invalidTime);

  const conditionB =
    Number.isFinite(openTimeMs) &&
    Number.isFinite(barCloseTimeMs) &&
    Number.isFinite(invalidTimeMs) &&
    (barCloseTimeMs as number) > (openTimeMs as number) &&
    (barCloseTimeMs as number) >= (invalidTimeMs as number);

  return conditionA || conditionB;
}
