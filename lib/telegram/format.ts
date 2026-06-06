import type { TradePlan } from "../tradelifecycle/types";
import { buildTradeReplayNote } from "../tradelifecycle/closeOutput";
import { DEFAULT_TELEGRAM_REFERENCE_LEVERAGE } from "./constants";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

function formatSignedPct(value: number): string {
  const rounded = value.toFixed(2);
  return value >= 0 ? `+${rounded}%` : `${rounded}%`;
}

function formatSignedR(value: number): string {
  const rounded = value.toFixed(2);
  return value >= 0 ? `+${rounded}R` : `${rounded}R`;
}

function buildTradeOpenReason(plan: TradePlan): string {
  const parts: string[] = [plan.source, plan.poiTier];

  if (plan.collabStrength) {
    parts.push(plan.collabStrength);
  }

  if (plan.entryQuality) {
    parts.push(plan.entryQuality);
  }

  return parts.join(" / ");
}

export function computeDirectionalPriceMovePct(args: {
  dir: "LONG" | "SHORT";
  fromPrice: number;
  toPrice: number;
}): number | null {
  const { dir, fromPrice, toPrice } = args;

  if (!isFiniteNumber(fromPrice) || !isFiniteNumber(toPrice) || fromPrice <= 0) {
    return null;
  }

  const raw =
    dir === "LONG"
      ? ((toPrice - fromPrice) / fromPrice) * 100
      : ((fromPrice - toPrice) / fromPrice) * 100;

  return Number.isFinite(raw) ? raw : null;
}

export function computeReferenceLeverageRoiPct(
  priceMovePct: number | null,
  leverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
): number | null {
  if (!isFiniteNumber(priceMovePct) || !isFiniteNumber(leverage) || leverage <= 0) {
    return null;
  }

  return priceMovePct * leverage;
}

export function formatTelegramTradeOpenMessage(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
): string {
  const stopPct = computeDirectionalPriceMovePct({
    dir: plan.dir,
    fromPrice: plan.entryRefPrice,
    toPrice: plan.stopPrice,
  });
  const tpPct = computeDirectionalPriceMovePct({
    dir: plan.dir,
    fromPrice: plan.entryRefPrice,
    toPrice: plan.tpPrice,
  });

  const stopLevPct = computeReferenceLeverageRoiPct(stopPct, referenceLeverage);
  const tpLevPct = computeReferenceLeverageRoiPct(tpPct, referenceLeverage);

  return [
    `[OPEN] ${plan.symbol} ${plan.dir} ${plan.tf}`,
    `\uC2DC\uAC01: ${plan.openTime}`,
    `\uC9C4\uC785 \uC774\uC720: ${buildTradeOpenReason(plan)}`,
    `\uC9C4\uC785\uAC00: ${formatPrice(plan.entryRefPrice)}`,
    `\uC190\uC808\uAC00: ${formatPrice(plan.stopPrice)} (${formatSignedPct(
      stopPct ?? 0
    )}, \uCC38\uACE0${referenceLeverage}x ${formatSignedPct(stopLevPct ?? 0)})`,
    `\uC775\uC808\uAC00: ${formatPrice(plan.tpPrice)} (${formatSignedPct(
      tpPct ?? 0
    )}, \uCC38\uACE0${referenceLeverage}x ${formatSignedPct(tpLevPct ?? 0)})`,
    `RR: ${plan.rrChosen.toFixed(2)} | \uC815\uCC45: ${
      plan.policySnapshot?.regimeState ?? "na"
    }`,
  ].join("\n");
}

export function formatTelegramTradeCloseMessage(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
): string {
  const entryBase = plan.entryFillPrice ?? plan.entryRefPrice;
  const movePct = isFiniteNumber(plan.exitPrice)
    ? computeDirectionalPriceMovePct({
        dir: plan.dir,
        fromPrice: entryBase,
        toPrice: plan.exitPrice,
      })
    : null;
  const refLevPct = computeReferenceLeverageRoiPct(movePct, referenceLeverage);

  const replayNote = buildTradeReplayNote(plan);
  const replayLine = replayNote
    ? `\uC790\uB3D9\uBCF5\uAE30: ${replayNote}`
    : "\uC790\uB3D9\uBCF5\uAE30: -";
  const weaknessLine =
    plan.weaknessCodes && plan.weaknessCodes.length
      ? `\uC57D\uC810: ${plan.weaknessCodes.join(", ")}`
      : "\uC57D\uC810: -";

  return [
    `[CLOSE] ${plan.symbol} ${plan.dir} ${plan.tf ?? "na"}`,
    `\uACB0\uACFC: ${plan.outcome ?? "na"}`,
    `\uC885\uB8CC\uC2DC\uAC01: ${plan.closeTime ?? "na"}`,
    `\uC885\uB8CC\uAC00: ${isFiniteNumber(plan.exitPrice) ? formatPrice(plan.exitPrice) : "na"}`,
    `\uAC00\uACA9\uBCC0\uB3D9: ${
      movePct == null ? "na" : formatSignedPct(movePct)
    } | \uCC38\uACE0${referenceLeverage}x: ${
      refLevPct == null ? "na" : formatSignedPct(refLevPct)
    }`,
    `R: ${isFiniteNumber(plan.rGross) ? formatSignedR(plan.rGross) : "na"}`,
    replayLine,
    weaknessLine,
  ].join("\n");
}
