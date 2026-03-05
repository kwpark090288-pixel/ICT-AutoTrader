import { PENETRATION_ATR, PENETRATION_ZONE } from "./constants";
import type { TouchPenetrationEvalResult } from "./types";

type TouchOverlapArgs = {
  wickHigh: number;
  wickLow: number;
  top: number;
  bottom: number;
};

type EvaluateTouchPenetrationFilterArgs = TouchOverlapArgs & {
  atrForTf: number;
};

export function computeTouchOverlapLen(
  args: TouchOverlapArgs
): number {
  const { wickHigh, wickLow, top, bottom } = args;

  return Math.max(0, Math.min(wickHigh, top) - Math.max(wickLow, bottom));
}

export function computeTouchPenetrationMin(
  atrForTf: number,
  zoneHeight: number
): number {
  return Math.max(atrForTf * PENETRATION_ATR, zoneHeight * PENETRATION_ZONE);
}

export function evaluateTouchPenetrationFilter(
  args: EvaluateTouchPenetrationFilterArgs
): TouchPenetrationEvalResult | null {
  const { wickHigh, wickLow, top, bottom, atrForTf } = args;

  if (!Number.isFinite(atrForTf) || atrForTf <= 0) {
    return null;
  }

  if (!(top > bottom)) {
    return null;
  }

  if (!(wickHigh >= wickLow)) {
    return null;
  }

  const zoneHeight = top - bottom;
  const overlapLen = computeTouchOverlapLen({
    wickHigh,
    wickLow,
    top,
    bottom,
  });

  const penetrationMin = computeTouchPenetrationMin(atrForTf, zoneHeight);

  return {
    overlapLen,
    penetrationMin,
    passTouchPenetration: overlapLen >= penetrationMin,
  };
}