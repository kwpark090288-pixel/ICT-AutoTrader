import { buildBoxId } from "../../id";
import {
  OB_RATIO_DISPLAY_DECIMALS,
  TICK_EPSILON_FACTOR,
} from "./constants";
import type {
  BoxType,
  Dir,
  ObTf,
  ObTickNormalizedZone,
} from "./types";

type NormalizeObZoneToTickArgs = {
  bottom: number;
  top: number;
  tick: number;
};

type BuildNormalizedObIdArgs = {
  symbol: string;
  type: BoxType;
  tf: ObTf;
  triggerTime: number;
  dir: Dir;
  zone: ObTickNormalizedZone;
};

export function getObCmpEpsilon(tick: number): number {
  return tick * TICK_EPSILON_FACTOR;
}

export function getObTickDecimals(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;

  const s = tick.toString().toLowerCase();

  if (s.includes("e-")) {
    const exp = Number(s.split("e-")[1]);
    return Number.isFinite(exp) ? exp : 0;
  }

  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function normalizeObZoneToTick(
  args: NormalizeObZoneToTickArgs
): ObTickNormalizedZone | null {
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

  const eps = getObCmpEpsilon(tick);

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

export function formatObTickNormalizedPrice(
  value: number,
  tick: number
): string {
  return value.toFixed(getObTickDecimals(tick));
}

export function formatObZoneForOutput(
  zone: ObTickNormalizedZone,
  tick: number
): string {
  return `${formatObTickNormalizedPrice(zone.bottomNorm, tick)}~${formatObTickNormalizedPrice(zone.topNorm, tick)}`;
}

export function buildNormalizedObId(
  args: BuildNormalizedObIdArgs
): string {
  const { symbol, type, tf, triggerTime, dir, zone } = args;

  return buildBoxId({
    symbol: symbol.toUpperCase(),
    type,
    tf,
    confTime: triggerTime,
    dir,
    bottomTick: zone.bottomTick,
    topTick: zone.topTick,
  });
}

export function formatObRatio2(value: number): string {
  return value.toFixed(OB_RATIO_DISPLAY_DECIMALS);
}
