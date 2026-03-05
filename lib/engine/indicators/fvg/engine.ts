import type { IndicatorEngine as EngineContract } from "../../contracts";
import type { Bar } from "../../types";
import { FVG_ATR_PERIOD, FVG_DETECT_TFS, MIN_ZONE_HEIGHT_ATR } from "./constants";
import { getAtrValueAtConfTime } from "./atr";
import type { DetectedWickFvg, FvgBar, FvgTf } from "./types";

export type FvgIndicatorEngine = EngineContract;

export function isFvgDetectTf(tf: string): tf is FvgTf {
  return (FVG_DETECT_TFS as readonly string[]).includes(tf);
}

function buildDetectedWickFvg(args: {
  tf: FvgTf;
  dir: "BULL" | "BEAR";
  left: FvgBar;
  middle: FvgBar;
  right: FvgBar;
  atrAtConf: number;
  bottom: number;
  top: number;
}): DetectedWickFvg | null {
  const { tf, dir, left, middle, right, atrAtConf, bottom, top } = args;

  const height = top - bottom;
  if (height < atrAtConf * MIN_ZONE_HEIGHT_ATR) {
    return null;
  }

  return {
    tf,
    dir,
    leftCloseTime: left.closeTime,
    middleCloseTime: middle.closeTime,
    rightCloseTime: right.closeTime,
    confTime: right.closeTime,
    atrAtConf,
    zone: {
      bottom,
      top,
      height,
    },
  };
}

export function detectConfirmedWickFvgFromRecentBars(
  recentBars: readonly FvgBar[],
  atrAtConf: number
): DetectedWickFvg | null {
  if (recentBars.length < 3) return null;
  if (!Number.isFinite(atrAtConf) || atrAtConf <= 0) return null;

  const [left, middle, right] = recentBars.slice(recentBars.length - 3);

  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!isFvgDetectTf(right.tf)) return null;

  if (!(left.closeTime < middle.closeTime && middle.closeTime < right.closeTime)) {
    return null;
  }

  if (left.high < right.low) {
    return buildDetectedWickFvg({
      tf: right.tf as FvgTf,
      dir: "BULL",
      left,
      middle,
      right,
      atrAtConf,
      bottom: left.high,
      top: right.low,
    });
  }

  if (left.low > right.high) {
    return buildDetectedWickFvg({
      tf: right.tf as FvgTf,
      dir: "BEAR",
      left,
      middle,
      right,
      atrAtConf,
      bottom: right.high,
      top: left.low,
    });
  }

  return null;
}

export function detectConfirmedWickFvgWithAtrFromTfBars(
  tfBars: readonly FvgBar[]
): DetectedWickFvg | null {
  if (tfBars.length < FVG_ATR_PERIOD) return null;
  if (tfBars.length < 3) return null;

  const recentBars = tfBars.slice(tfBars.length - 3);
  const confTime = recentBars[2].closeTime;
  const atrAtConf = getAtrValueAtConfTime(tfBars, confTime);

  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  return detectConfirmedWickFvgFromRecentBars(
    recentBars,
    atrAtConf as number
  );
}

export function createFvgIndicatorEngine(): FvgIndicatorEngine {
  return {
    onBarClose(_bar: Bar): string[] {
      return [];
    },
  };
}
