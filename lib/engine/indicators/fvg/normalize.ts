import { buildBoxId } from "../../id";
import {
  STACK_RATIO_DISPLAY_DECIMALS,
  TICK_EPSILON_FACTOR,
} from "./constants";
import type {
  BoxType,
  Dir,
  FvgTf,
  TickNormalizedZone,
} from "./types";

type NormalizeFvgZoneToTickArgs = {
  bottom: number;
  top: number;
  tick: number;
};

type BuildNormalizedFvgIdArgs = {
  symbol: string;
  type: BoxType;
  tf: FvgTf;
  confTime: number;
  dir: Dir;
  zone: TickNormalizedZone;
};

export function getTickDecimals(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;

  const s = tick.toString().toLowerCase();

  if (s.includes("e-")) {
    const exp = Number(s.split("e-")[1]);
    return Number.isFinite(exp) ? exp : 0;
  }

  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function normalizeFvgZoneToTick(
  args: NormalizeFvgZoneToTickArgs
): TickNormalizedZone | null {
  const { bottom, top, tick } = args;

  if (!Number.isFinite(bottom) || !Number.isFinite(top)) {
    return null;
  }

  if (!Number.isFinite(tick) || tick <= 0) {
    return null;
  }

  if (!(top > bottom)) {
    return null;
  }

  const eps = tick * TICK_EPSILON_FACTOR;

  const bottomTick = Math.floor((bottom + eps) / tick);
  const topTick = Math.ceil((top - eps) / tick);

  if (topTick < bottomTick) {
    return null;
  }

  return {
    bottomTick,
    topTick,
    bottomNorm: bottomTick * tick,
    topNorm: topTick * tick,
  };
}

export function formatTickNormalizedPrice(
  value: number,
  tick: number
): string {
  return value.toFixed(getTickDecimals(tick));
}

export function formatFvgZoneForOutput(
  zone: TickNormalizedZone,
  tick: number
): string {
  return `${formatTickNormalizedPrice(zone.bottomNorm, tick)}~${formatTickNormalizedPrice(zone.topNorm, tick)}`;
}

export function buildNormalizedFvgId(
  args: BuildNormalizedFvgIdArgs
): string {
  const { symbol, type, tf, confTime, dir, zone } = args;

  return buildBoxId({
    symbol: symbol.toUpperCase(),
    type,
    tf,
    confTime,
    dir,
    bottomTick: zone.bottomTick,
    topTick: zone.topTick,
  });
}

export function formatRatio2(value: number): string {
  return value.toFixed(STACK_RATIO_DISPLAY_DECIMALS);
}
