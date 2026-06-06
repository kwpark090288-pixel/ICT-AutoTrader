import {
  MAX_OB_HEIGHT_ATR_D1,
  MAX_OB_HEIGHT_ATR_H4,
  MAX_OB_HEIGHT_ATR_SETUP,
  MIN_OB_HEIGHT_ATR,
  OB_DETECT_TFS,
} from "./constants";
import type { ObZoneHeightFilterEvalResult } from "./types";

export type ObHeightFilterTf = "D1" | "H4" | "H1" | "M30";

type EvaluateObZoneHeightFilterArgs = {
  tf: string;
  zoneHeight: number;
  atrAtTrigger: number;
};

export function isObHeightFilterTf(tf: string): tf is ObHeightFilterTf {
  return (OB_DETECT_TFS as readonly string[]).includes(tf);
}

export function getMaxObHeightAtrMultiplier(tf: ObHeightFilterTf): number {
  if (tf === "D1") return MAX_OB_HEIGHT_ATR_D1;
  if (tf === "H4") return MAX_OB_HEIGHT_ATR_H4;
  return MAX_OB_HEIGHT_ATR_SETUP;
}

export function evaluateObZoneHeightFilter(
  args: EvaluateObZoneHeightFilterArgs
): ObZoneHeightFilterEvalResult | null {
  const { tf, zoneHeight, atrAtTrigger } = args;

  if (!isObHeightFilterTf(tf)) {
    return null;
  }

  if (!Number.isFinite(zoneHeight) || zoneHeight <= 0) {
    return null;
  }

  if (!Number.isFinite(atrAtTrigger) || atrAtTrigger <= 0) {
    return null;
  }

  const minAllowed = atrAtTrigger * MIN_OB_HEIGHT_ATR;
  const maxAllowed = atrAtTrigger * getMaxObHeightAtrMultiplier(tf);

  const passMin = zoneHeight >= minAllowed;
  const passMax = zoneHeight <= maxAllowed;

  return {
    tf,
    zoneHeight,
    atrAtTrigger,
    minAllowed,
    maxAllowed,
    passMin,
    passMax,
    passHeightFilter: passMin && passMax,
  };
}
