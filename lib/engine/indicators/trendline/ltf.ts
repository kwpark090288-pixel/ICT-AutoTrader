import { uniqueLexicographicTags } from "../../tags";
import {
  TRENDLINE_LTF_GATE_ATR,
  TRENDLINE_LTF_MICRO_PIVOT_LEN,
  TRENDLINE_LTF_SWEEP_RECOVERY_MAX_BARS,
  TRENDLINE_MICRO_FVG_MIN_ZONE_HEIGHT_ATR,
  TRENDLINE_MICRO_OB_LOOKBACK_BARS,
  TRENDLINE_REACTION_TFS,
} from "./constants";
import { getTrendlineLinePriceAt } from "./lifecycle";
import type {
  Pivot,
  Trendline,
  TrendlineBar,
  TrendlineLtfGateEvalResult,
  TrendlineLtfMicroRetestType,
  TrendlineLtfTriggerEvalResult,
  TrendlineLtfTriggerToken,
  TrendlineReactionTf,
  Zone,
} from "./types";

const ATR_PERIOD = 14;
const CMP_EPS_FACTOR = 1e-6;

function assertSameTfAscending(bars: readonly TrendlineBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Trendline LTF bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Trendline LTF bars must be strictly ascending by closeTime");
    }
  }
}

function computeTrueRange(bar: TrendlineBar, prevClose?: number): number {
  const highLow = bar.high - bar.low;

  if (!Number.isFinite(prevClose)) {
    return highLow;
  }

  return Math.max(
    highLow,
    Math.abs(bar.high - (prevClose as number)),
    Math.abs(bar.low - (prevClose as number))
  );
}

function getAtrValueAtCloseTime(
  tfBars: readonly TrendlineBar[],
  closeTime: number
): number | null {
  if (tfBars.length < ATR_PERIOD) {
    return null;
  }

  assertSameTfAscending(tfBars);

  const trValues: number[] = [];
  let atr: number | null = null;

  for (let i = 0; i < tfBars.length; i += 1) {
    const prevClose = i > 0 ? tfBars[i - 1].close : undefined;
    const tr = computeTrueRange(tfBars[i], prevClose);

    if (i < ATR_PERIOD - 1) {
      trValues.push(tr);
      continue;
    }

    if (i === ATR_PERIOD - 1) {
      trValues.push(tr);
      atr = trValues.reduce((sum, v) => sum + v, 0) / ATR_PERIOD;
    } else {
      atr = (((atr as number) * (ATR_PERIOD - 1)) + tr) / ATR_PERIOD;
    }

    if (tfBars[i].closeTime === closeTime) {
      return atr;
    }
  }

  return null;
}

function getTrendlineIntentDir(line: Trendline): "BULL" | "BEAR" {
  return line.type === "TL_SUPPORT" ? "BULL" : "BEAR";
}

function getCmpEps(tickSize: number): number {
  return tickSize * CMP_EPS_FACTOR;
}

export function isTrendlineReactionTf(
  tf: string
): tf is TrendlineReactionTf {
  return (TRENDLINE_REACTION_TFS as readonly string[]).includes(tf);
}

export function evaluateTrendlineLtfGateOnBar(args: {
  line: Trendline;
  bar: TrendlineBar;
  atrAtBar: number;
}): TrendlineLtfGateEvalResult | null {
  const { line, bar, atrAtBar } = args;

  if (!isTrendlineReactionTf(bar.tf)) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;

  const dir = getTrendlineIntentDir(line);
  const boundaryPrice = getTrendlineLinePriceAt(line, bar.closeTime);
  const wickExtreme = dir === "BULL" ? bar.low : bar.high;
  const dist = Math.abs(wickExtreme - boundaryPrice);

  return {
    tf: bar.tf,
    dir,
    currentCloseTime: bar.closeTime,
    boundaryPrice,
    wickExtreme,
    dist,
    atrAtBar,
    gateAtrMultiplier: TRENDLINE_LTF_GATE_ATR,
    passGate: dist <= atrAtBar * TRENDLINE_LTF_GATE_ATR,
  };
}

export function evaluateTrendlineLtfGateFromTfBars(args: {
  line: Trendline;
  tfBars: readonly TrendlineBar[];
}): TrendlineLtfGateEvalResult | null {
  const { line, tfBars } = args;

  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtBar = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtBar)) {
    return null;
  }

  return evaluateTrendlineLtfGateOnBar({
    line,
    bar: currentBar,
    atrAtBar: atrAtBar as number,
  });
}

export function detectConfirmedTrendlineMicroPivotAtIndex(
  tfBars: readonly TrendlineBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) return null;
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const center = tfBars[pivotIndex];
  if (!center) return null;
  if (!isTrendlineReactionTf(center.tf)) return null;

  const leftStart = pivotIndex - TRENDLINE_LTF_MICRO_PIVOT_LEN;
  const rightEnd = pivotIndex + TRENDLINE_LTF_MICRO_PIVOT_LEN;

  if (leftStart < 0) return null;
  if (rightEnd >= tfBars.length) return null;

  if (pivotType === "HIGH") {
    for (let i = leftStart; i <= rightEnd; i += 1) {
      if (i === pivotIndex) continue;
      if (center.high <= tfBars[i].high) {
        return null;
      }
    }

    return {
      tf: center.tf,
      pivotType: "HIGH",
      pivotTime: center.closeTime,
      pivotPrice: center.high,
      confirmedAt: tfBars[rightEnd].closeTime,
      isConfirmed: true,
    };
  }

  for (let i = leftStart; i <= rightEnd; i += 1) {
    if (i === pivotIndex) continue;
    if (center.low >= tfBars[i].low) {
      return null;
    }
  }

  return {
    tf: center.tf,
    pivotType: "LOW",
    pivotTime: center.closeTime,
    pivotPrice: center.low,
    confirmedAt: tfBars[rightEnd].closeTime,
    isConfirmed: true,
  };
}

function getConfirmedTrendlineMicroPivotsUpToTime(
  tfBars: readonly TrendlineBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): Pivot[] {
  const out: Pivot[] = [];

  for (
    let pivotIndex = TRENDLINE_LTF_MICRO_PIVOT_LEN;
    pivotIndex <= tfBars.length - 1 - TRENDLINE_LTF_MICRO_PIVOT_LEN;
    pivotIndex += 1
  ) {
    const pivot = detectConfirmedTrendlineMicroPivotAtIndex(
      tfBars,
      pivotType,
      pivotIndex
    );

    if (!pivot) continue;
    if (pivot.confirmedAt <= currentCloseTime) {
      out.push(pivot);
    }
  }

  return out;
}

export function getLatestConfirmedTrendlineMicroPivot(
  tfBars: readonly TrendlineBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): Pivot | null {
  const pivots = getConfirmedTrendlineMicroPivotsUpToTime(
    tfBars,
    pivotType,
    currentCloseTime
  );

  return pivots.length ? pivots[pivots.length - 1] : null;
}

function computeOverlapLen(bar: TrendlineBar, zone: Zone): number {
  return Math.max(
    0,
    Math.min(bar.high, zone.top) - Math.max(bar.low, zone.bottom)
  );
}

function findLatestTrendlineLtfBreakIndex(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  tickSize: number,
  maxIndex: number
): number | null {
  for (let i = maxIndex; i >= 0; i -= 1) {
    if (
      evaluateTrendlineLtfChochTrigger(
        tfBars.slice(0, i + 1),
        dir,
        tickSize
      )
    ) {
      return i;
    }
  }

  return null;
}

function getMicroObZoneFromBreakIndex(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  breakIndex: number
): Zone | null {
  const start = Math.max(
    0,
    breakIndex - TRENDLINE_MICRO_OB_LOOKBACK_BARS
  );

  for (let i = breakIndex - 1; i >= start; i -= 1) {
    const bar = tfBars[i];
    if (!bar) continue;

    if (dir === "BULL" && bar.close < bar.open) {
      return {
        bottom: bar.low,
        top: bar.open,
        height: bar.open - bar.low,
      };
    }

    if (dir === "BEAR" && bar.close > bar.open) {
      return {
        bottom: bar.open,
        top: bar.high,
        height: bar.high - bar.open,
      };
    }
  }

  return null;
}

type DetectedTrendlineMicroFvg = {
  dir: "BULL" | "BEAR";
  confTime: number;
  zone: Zone;
};

function detectConfirmedTrendlineMicroFvgAtEndIndex(
  tfBars: readonly TrendlineBar[],
  endIndex: number
): DetectedTrendlineMicroFvg | null {
  if (endIndex < 2) return null;

  const left = tfBars[endIndex - 2];
  const middle = tfBars[endIndex - 1];
  const right = tfBars[endIndex];

  if (!left || !middle || !right) return null;
  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!isTrendlineReactionTf(right.tf)) return null;

  const atrAtConf = getAtrValueAtCloseTime(tfBars, right.closeTime);
  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  if (left.high < right.low) {
    const bottom = left.high;
    const top = right.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * TRENDLINE_MICRO_FVG_MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      dir: "BULL",
      confTime: right.closeTime,
      zone: { bottom, top, height },
    };
  }

  if (left.low > right.high) {
    const bottom = right.high;
    const top = left.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * TRENDLINE_MICRO_FVG_MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      dir: "BEAR",
      confTime: right.closeTime,
      zone: { bottom, top, height },
    };
  }

  return null;
}

function findLatestConfirmedTrendlineMicroFvg(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  maxEndIndex: number
): DetectedTrendlineMicroFvg | null {
  for (let endIndex = maxEndIndex; endIndex >= 2; endIndex -= 1) {
    const fvg = detectConfirmedTrendlineMicroFvgAtEndIndex(tfBars, endIndex);
    if (fvg && fvg.dir === dir) {
      return fvg;
    }
  }

  return null;
}

export function evaluateTrendlineLtfChochTrigger(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  tickSize: number
): boolean {
  if (tfBars.length === 0) return false;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isTrendlineReactionTf(currentBar.tf)) return false;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return false;

  const eps = getCmpEps(tickSize);

  if (dir === "BULL") {
    const pivotHigh = getLatestConfirmedTrendlineMicroPivot(
      tfBars,
      "HIGH",
      currentBar.closeTime
    );
    if (!pivotHigh) return false;

    return currentBar.close > pivotHigh.pivotPrice + eps;
  }

  const pivotLow = getLatestConfirmedTrendlineMicroPivot(
    tfBars,
    "LOW",
    currentBar.closeTime
  );
  if (!pivotLow) return false;

  return currentBar.close < pivotLow.pivotPrice - eps;
}

type EvaluateTrendlineSweepRecTriggerNowArgs = {
  line: Trendline;
  tfBars: readonly TrendlineBar[];
  currentIndex: number;
  tickSize: number;
};

export function evaluateTrendlineSweepRecTriggerNow(
  args: EvaluateTrendlineSweepRecTriggerNowArgs
): boolean {
  const { line, tfBars, currentIndex, tickSize } = args;

  if (line.state !== "ACTIVE") return false;
  if (!Number.isInteger(currentIndex)) return false;
  if (currentIndex < 1 || currentIndex >= tfBars.length) return false;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return false;

  assertSameTfAscending(tfBars);

  const eps = getCmpEps(tickSize);
  const dir = getTrendlineIntentDir(line);
  const recoveryBar = tfBars[currentIndex];
  const recoveryLine = getTrendlineLinePriceAt(line, recoveryBar.closeTime);
  const recovery =
    dir === "BULL"
      ? recoveryBar.close > recoveryLine + eps
      : recoveryBar.close < recoveryLine - eps;

  if (!recovery) {
    return false;
  }

  for (
    let sweepIndex = Math.max(0, currentIndex - TRENDLINE_LTF_SWEEP_RECOVERY_MAX_BARS);
    sweepIndex <= currentIndex - 1;
    sweepIndex += 1
  ) {
    const sweepBar = tfBars[sweepIndex];
    const sweepLine = getTrendlineLinePriceAt(line, sweepBar.closeTime);

    const sweep =
      dir === "BULL"
        ? sweepBar.low < sweepLine - eps
        : sweepBar.high > sweepLine + eps;

    let priorRecoverySeen = false;

    for (let i = sweepIndex + 1; i < currentIndex; i += 1) {
      const bar = tfBars[i];
      const linePrice = getTrendlineLinePriceAt(line, bar.closeTime);

      const barRecovered =
        dir === "BULL"
          ? bar.close > linePrice + eps
          : bar.close < linePrice - eps;

      if (barRecovered) {
        priorRecoverySeen = true;
        break;
      }
    }

    if (sweep && !priorRecoverySeen) {
      return true;
    }
  }

  return false;
}

export function evaluateTrendlineMicroObRetestTrigger(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  tickSize: number
): TrendlineLtfMicroRetestType | null {
  if (tfBars.length < 2) return null;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return null;

  assertSameTfAscending(tfBars);

  const k = tfBars.length - 1;
  const touchBar = tfBars[k - 1];
  const confirmBar = tfBars[k];
  const eps = getCmpEps(tickSize);

  const breakIndex = findLatestTrendlineLtfBreakIndex(
    tfBars,
    dir,
    tickSize,
    k - 2
  );

  if (breakIndex === null) {
    return null;
  }

  const zone = getMicroObZoneFromBreakIndex(tfBars, dir, breakIndex);
  if (!zone || !(zone.top > zone.bottom)) {
    return null;
  }

  const touchOk = computeOverlapLen(touchBar, zone) > 0;
  const confirmOk =
    dir === "BULL"
      ? confirmBar.close > zone.top + eps
      : confirmBar.close < zone.bottom - eps;

  return touchOk && confirmOk ? "MR_MICRO_OB" : null;
}

export function evaluateTrendlineMicroFvgRetestTrigger(
  tfBars: readonly TrendlineBar[],
  dir: "BULL" | "BEAR",
  tickSize: number
): TrendlineLtfMicroRetestType | null {
  if (tfBars.length < 2) return null;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return null;

  assertSameTfAscending(tfBars);

  const k = tfBars.length - 1;
  const touchBar = tfBars[k - 1];
  const confirmBar = tfBars[k];
  const eps = getCmpEps(tickSize);

  const microFvg = findLatestConfirmedTrendlineMicroFvg(
    tfBars,
    dir,
    k - 2
  );

  if (!microFvg) {
    return null;
  }

  const touchOk =
    dir === "BULL"
      ? touchBar.low <= microFvg.zone.bottom + eps
      : touchBar.high >= microFvg.zone.top - eps;

  const confirmOk =
    dir === "BULL"
      ? confirmBar.close > microFvg.zone.bottom + eps
      : confirmBar.close < microFvg.zone.top - eps;

  return touchOk && confirmOk ? "MR_MICRO_FVG" : null;
}

export function sortUniqueTrendlineLtfTriggerTokens(
  triggers: readonly TrendlineLtfTriggerToken[]
): TrendlineLtfTriggerToken[] {
  return uniqueLexicographicTags(triggers) as TrendlineLtfTriggerToken[];
}

type EvaluateTrendlineLtfTriggersArgs = {
  line: Trendline;
  tfBars: readonly TrendlineBar[];
  currentIndex: number;
  tickSize: number;
};

export function evaluateTrendlineLtfTriggers(
  args: EvaluateTrendlineLtfTriggersArgs
): TrendlineLtfTriggerEvalResult | null {
  const { line, tfBars, currentIndex, tickSize } = args;

  if (line.state !== "ACTIVE") return null;
  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= tfBars.length) return null;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return null;

  const currentBar = tfBars[currentIndex];
  if (!isTrendlineReactionTf(currentBar.tf)) {
    return null;
  }

  const dir = getTrendlineIntentDir(line);

  const choch = evaluateTrendlineLtfChochTrigger(
    tfBars.slice(0, currentIndex + 1),
    dir,
    tickSize
  );

  const sweepRec = evaluateTrendlineSweepRecTriggerNow({
    line,
    tfBars,
    currentIndex,
    tickSize,
  });

  const microRetestTypes = [
    evaluateTrendlineMicroFvgRetestTrigger(
      tfBars.slice(0, currentIndex + 1),
      dir,
      tickSize
    ),
    evaluateTrendlineMicroObRetestTrigger(
      tfBars.slice(0, currentIndex + 1),
      dir,
      tickSize
    ),
  ].filter((v): v is TrendlineLtfMicroRetestType => Boolean(v));

  const triggers: TrendlineLtfTriggerToken[] = [];
  if (choch) triggers.push("CHOCH");
  if (sweepRec) triggers.push("SWEEP_REC");
  triggers.push(...microRetestTypes);

  return {
    tf: currentBar.tf,
    dir,
    currentCloseTime: currentBar.closeTime,
    choch,
    sweepRec,
    microRetestTypes: uniqueLexicographicTags(
      microRetestTypes
    ) as TrendlineLtfMicroRetestType[],
    triggers: sortUniqueTrendlineLtfTriggerTokens(triggers),
  };
}

type EvaluateTrendlineLtfTriggersFromTfBarsArgs = {
  line: Trendline;
  tfBars: readonly TrendlineBar[];
  tickSize: number;
};

export function evaluateTrendlineLtfTriggersFromTfBars(
  args: EvaluateTrendlineLtfTriggersFromTfBarsArgs
): TrendlineLtfTriggerEvalResult | null {
  const { line, tfBars, tickSize } = args;

  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtClose = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtClose)) {
    return null;
  }

  return evaluateTrendlineLtfTriggers({
    line,
    tfBars,
    currentIndex: tfBars.length - 1,
    tickSize,
  });
}
