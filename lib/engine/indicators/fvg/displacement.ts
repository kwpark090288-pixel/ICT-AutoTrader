import {
  DISPLACEMENT_BODY_MAX_ATR,
  DISPLACEMENT_BODY_SUM_ATR,
} from "./constants";
import { getAtrValueAtConfTime } from "./atr";
import type { DisplacementEvalResult, FvgBar } from "./types";

export function getCandleBodySize(bar: FvgBar): number {
  return Math.abs(bar.close - bar.open);
}

export function evaluateDisplacementF1FromRecentBars(
  recentBars: readonly FvgBar[],
  atrAtConf: number
): DisplacementEvalResult | null {
  if (recentBars.length < 3) return null;
  if (!Number.isFinite(atrAtConf) || atrAtConf <= 0) return null;

  const [left, middle, right] = recentBars.slice(recentBars.length - 3);

  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!(left.closeTime < middle.closeTime && middle.closeTime < right.closeTime)) {
    return null;
  }

  const bodies = [
    getCandleBodySize(left),
    getCandleBodySize(middle),
    getCandleBodySize(right),
  ];

  const bodyMax = Math.max(...bodies);
  const bodySum = bodies.reduce((sum, value) => sum + value, 0);

  const passByMax = bodyMax > atrAtConf * DISPLACEMENT_BODY_MAX_ATR;
  const passBySum = bodySum > atrAtConf * DISPLACEMENT_BODY_SUM_ATR;

  return {
    confTime: right.closeTime,
    atrAtConf,
    bodyMax,
    bodySum,
    passByMax,
    passBySum,
    passDisplacement: passByMax || passBySum,
  };
}

export function evaluateDisplacementF1FromTfBars(
  tfBars: readonly FvgBar[]
): DisplacementEvalResult | null {
  if (tfBars.length < 3) return null;

  const recentBars = tfBars.slice(tfBars.length - 3);
  const confTime = recentBars[2].closeTime;
  const atrAtConf = getAtrValueAtConfTime(tfBars, confTime);

  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  return evaluateDisplacementF1FromRecentBars(
    recentBars,
    atrAtConf as number
  );
}
