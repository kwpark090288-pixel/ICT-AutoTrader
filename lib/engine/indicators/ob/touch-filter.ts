import { PENETRATION_ATR, PENETRATION_ZONE } from "./constants";
import type { ObTouchPenetrationEvalResult } from "./types";

type ObTouchOverlapArgs = {
  wickHigh: number;
  wickLow: number;
  top: number;
  bottom: number;
};

type EvaluateObTouchPenetrationFilterArgs = ObTouchOverlapArgs & {
  atrForTf: number;
};

export function computeObTouchOverlapLen(
  args: ObTouchOverlapArgs
): number {
  const { wickHigh, wickLow, top, bottom } = args;

  return Math.max(0, Math.min(wickHigh, top) - Math.max(wickLow, bottom));
}

export function computeObTouchPenetrationMin(
  atrForTf: number,
  zoneHeight: number
): number {
  return Math.max(atrForTf * PENETRATION_ATR, zoneHeight * PENETRATION_ZONE);
}

export function evaluateObTouchPenetrationFilter(
  args: EvaluateObTouchPenetrationFilterArgs
): ObTouchPenetrationEvalResult | null {
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
  const overlapLen = computeObTouchOverlapLen({
    wickHigh,
    wickLow,
    top,
    bottom,
  });

  const penetrationMin = computeObTouchPenetrationMin(atrForTf, zoneHeight);

  return {
    overlapLen,
    penetrationMin,
    passTouchPenetration: overlapLen >= penetrationMin,
  };
}
