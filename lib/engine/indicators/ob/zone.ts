import type { DetectedObZoneCandidate, Dir, ObBar, Zone } from "./types";

const LAST_OPP_CANDLE_LOOKBACK_BARS = 6;

function assertSameTfAscending(bars: readonly ObBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("OB zone bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("OB zone bars must be strictly ascending by closeTime");
    }
  }
}

export function isOppositeColorCandleForOb(
  bar: ObBar,
  dir: Dir
): boolean {
  if (dir === "BULL") {
    return bar.close < bar.open;
  }

  return bar.close > bar.open;
}

export function buildObZoneFromCandle(
  bar: ObBar,
  dir: Dir
): Zone {
  if (dir === "BULL") {
    return {
      bottom: bar.low,
      top: bar.open,
      height: bar.open - bar.low,
    };
  }

  return {
    bottom: bar.open,
    top: bar.high,
    height: bar.high - bar.open,
  };
}

export function findLastOppositeColorCandleIndex(
  tfBars: readonly ObBar[],
  dir: Dir,
  triggerIndex: number
): number | null {
  if (!Number.isInteger(triggerIndex)) return null;
  if (triggerIndex <= 0 || triggerIndex >= tfBars.length) return null;

  assertSameTfAscending(tfBars);

  const start = Math.max(0, triggerIndex - LAST_OPP_CANDLE_LOOKBACK_BARS);

  for (let i = triggerIndex - 1; i >= start; i -= 1) {
    if (isOppositeColorCandleForOb(tfBars[i], dir)) {
      return i;
    }
  }

  return null;
}

export function detectObZoneCandidateFromTriggerIndex(
  tfBars: readonly ObBar[],
  dir: Dir,
  triggerIndex: number
): DetectedObZoneCandidate | null {
  const obCandleIndex = findLastOppositeColorCandleIndex(
    tfBars,
    dir,
    triggerIndex
  );

  if (obCandleIndex === null) {
    return null;
  }

  const obCandle = tfBars[obCandleIndex];
  const triggerBar = tfBars[triggerIndex];

  return {
    triggerIndex,
    obCandleIndex,
    triggerTime: triggerBar.closeTime,
    obCandleTime: obCandle.closeTime,
    dir,
    zone: buildObZoneFromCandle(obCandle, dir),
  };
}
