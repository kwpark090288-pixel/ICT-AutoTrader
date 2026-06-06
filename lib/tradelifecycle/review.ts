import { uniqueLexicographicTags } from "../engine/tags";
import type {
  TradePlan,
  TradeStrengthCode,
  TradeTimeoutSign,
  TradeWeaknessCode,
} from "./types";

function getRiskUnit(
  entryPrice: number,
  stopPrice: number
): number | null {
  const s = Math.abs(entryPrice - stopPrice);
  return Number.isFinite(s) && s > 0 ? s : null;
}

function getDirSign(dir: TradePlan["dir"]): 1 | -1 | null {
  if (dir === "LONG") {
    return 1;
  }

  if (dir === "SHORT") {
    return -1;
  }

  return null;
}

export function computeTradeRGross(
  plan: TradePlan
): number | null {
  if (!Number.isFinite(plan.exitPrice)) {
    return null;
  }

  const s = getRiskUnit(plan.entryRefPrice, plan.stopPrice);
  const dirSign = getDirSign(plan.dir);

  if (!Number.isFinite(s) || dirSign === null) {
    return null;
  }

  return (
    dirSign * ((plan.exitPrice as number) - plan.entryRefPrice)
  ) / (s as number);
}

export function computeTradeRAfterCost(
  plan: TradePlan
): number | null {
  const rGross = computeTradeRGross(plan);
  const cBps = plan.policySnapshot?.c_bps;
  const s = getRiskUnit(plan.entryRefPrice, plan.stopPrice);

  if (
    !Number.isFinite(rGross) ||
    !Number.isFinite(cBps) ||
    !Number.isFinite(s)
  ) {
    return null;
  }

  const costPrice = plan.entryRefPrice * ((cBps as number) / 10000);
  const costR = costPrice / (s as number);

  return (rGross as number) - costR;
}

export function computeTradeRFillGross(
  plan: TradePlan
): number | null {
  if (!Number.isFinite(plan.entryFillPrice) || !Number.isFinite(plan.exitPrice)) {
    return null;
  }

  const dirSign = getDirSign(plan.dir);
  if (dirSign === null) {
    return null;
  }

  const fallbackS = getRiskUnit(plan.entryRefPrice, plan.stopPrice);
  const rawSFill = Math.abs(
    (plan.entryFillPrice as number) - plan.stopPrice
  );
  const sFill =
    Number.isFinite(rawSFill) && rawSFill > 0
      ? rawSFill
      : fallbackS;

  if (!Number.isFinite(sFill) || (sFill as number) <= 0) {
    return null;
  }

  return (
    dirSign * ((plan.exitPrice as number) - (plan.entryFillPrice as number))
  ) / (sFill as number);
}

export function computeTradeRFillAfterCost(
  plan: TradePlan
): number | null {
  const rFillGross = computeTradeRFillGross(plan);
  const cBps = plan.policySnapshot?.c_bps;

  if (
    !Number.isFinite(rFillGross) ||
    !Number.isFinite(cBps) ||
    !Number.isFinite(plan.entryFillPrice)
  ) {
    return null;
  }

  const fallbackS = getRiskUnit(plan.entryRefPrice, plan.stopPrice);
  const rawSFill = Math.abs(
    (plan.entryFillPrice as number) - plan.stopPrice
  );
  const sFill =
    Number.isFinite(rawSFill) && rawSFill > 0
      ? rawSFill
      : fallbackS;

  if (!Number.isFinite(sFill) || (sFill as number) <= 0) {
    return null;
  }

  const costPrice =
    (plan.entryFillPrice as number) * ((cBps as number) / 10000);
  const costR = costPrice / (sFill as number);

  return (rFillGross as number) - costR;
}

export function computeTradeTimeoutSign(
  plan: TradePlan
): TradeTimeoutSign {
  if (plan.outcome !== "TIMEOUT") {
    return "na";
  }

  const rGross = Number.isFinite(plan.rGross)
    ? (plan.rGross as number)
    : computeTradeRGross(plan);

  if (!Number.isFinite(rGross)) {
    return "na";
  }

  if ((rGross as number) > 0.1) {
    return "PROFIT";
  }

  if ((rGross as number) < -0.1) {
    return "LOSS";
  }

  return "FLAT";
}

export function collectTradeStrengthCodes(
  plan: TradePlan
): TradeStrengthCode[] {
  const out: TradeStrengthCode[] = [];

  if (plan.poiTier === "D1_POI" || plan.poiTier === "H4_CORE") {
    out.push("S_POI_TIER_HIGH");
  }

  if (plan.collabStrength === "STRONG") {
    out.push("S_COLLAB_STRONG");
  }

  if (plan.entryQuality === "IDEAL") {
    out.push("S_ENTRY_IDEAL");
  }

  if (plan.tpMode === "LIQ") {
    out.push("S_TP_MODE_LIQ");
  }

  if (Number.isFinite(plan.score) && (plan.score as number) >= 90) {
    out.push("S_SCORE_HIGH");
  }

  if (plan.policySnapshot?.regimeState === "NORMAL") {
    out.push("S_POLICY_OK");
  }

  return uniqueLexicographicTags(out) as TradeStrengthCode[];
}

export function collectTradeWeaknessCodes(
  plan: TradePlan
): TradeWeaknessCode[] {
  const out: TradeWeaknessCode[] = [];
  const timeoutSign =
    plan.timeoutSign ?? computeTradeTimeoutSign(plan);

  if (
    plan.policySnapshot?.regimeState === "CAUTION" ||
    plan.policySnapshot?.regimeState === "TRANSITION"
  ) {
    out.push("W_POLICY_CAUTION");
  }

  if (plan.entryQuality === "LATE") {
    out.push("W_ENTRY_LATE");
  }

  if (plan.tpMode === "RR") {
    out.push("W_TP_MODE_RR");
  }

  if (Number.isFinite(plan.rrChosen) && plan.rrChosen < 1.4) {
    out.push("W_RR_LOW");
  }

  if (
    Number.isFinite(plan.policySnapshot?.sc) &&
    (plan.policySnapshot?.sc as number) < 3.5
  ) {
    out.push("W_SC_LOW");
  }

  if (plan.bothHit === true) {
    out.push("W_BOTH_HIT");
  }

  if (
    ((plan.outcome === "HARD_SL" || plan.outcome === "SOFT_INVALID") &&
      Number.isFinite(plan.mfeR) &&
      plan.mfeR >= 1.0) ||
    (plan.outcome === "TIMEOUT" &&
      timeoutSign === "LOSS" &&
      Number.isFinite(plan.mfeR) &&
      plan.mfeR >= 1.0)
  ) {
    out.push("W_GAVE_BACK_PROFIT");
  }

  return uniqueLexicographicTags(out) as TradeWeaknessCode[];
}

export function finalizeClosedTradeReview(
  plan: TradePlan
): TradePlan {
  const rGross = computeTradeRGross(plan);
  const rAfterCost = computeTradeRAfterCost(plan);
  const rFillGross = computeTradeRFillGross(plan);
  const rFillAfterCost = computeTradeRFillAfterCost(plan);
  const timeoutSign = computeTradeTimeoutSign({
    ...plan,
    rGross: rGross ?? undefined,
  });
  const strengthCodes = collectTradeStrengthCodes(plan);
  const weaknessCodes = collectTradeWeaknessCodes({
    ...plan,
    timeoutSign,
  });

  return {
    ...plan,
    rGross: rGross ?? undefined,
    rAfterCost,
    rFillGross,
    rFillAfterCost,
    timeoutSign,
    strengthCodes,
    weaknessCodes,
  };
}
