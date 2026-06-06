import { uniqueLexicographicTags } from "../../tags";
import {
  EQ_BAND_ATR,
  LTF_GATE_ATR,
  LTF_MICRO_PIVOT_LEN,
  LTF_SWEEP_RECOVERY_MAX_BARS,
  MICRO_FVG_MIN_ZONE_HEIGHT_ATR,
  MICRO_OB_LOOKBACK_BARS,
  OB_REACTION_TFS,
} from "./constants";
import type {
  D1PoiOb,
  DetectedObZoneCandidate,
  Dir,
  H4CoreOb,
  ObBar,
  ObLtfGateEvalResult,
  ObLtfMicroRetestType,
  ObLtfTriggerEvalResult,
  ObLtfTriggerToken,
  ObSweepRecoveryTarget,
  Pivot,
  SetupOb,
  Zone,
} from "./types";

const ATR_PERIOD = 14;

export type ObLtfPoi = D1PoiOb | H4CoreOb | SetupOb;
export type ObLtfReactionTf = "M15" | "M5";

function assertSameTfAscending(bars: readonly ObBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("OB LTF bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("OB LTF bars must be strictly ascending by closeTime");
    }
  }
}

function computeTrueRange(bar: ObBar, prevClose?: number): number {
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
  tfBars: readonly ObBar[],
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

export function isObLtfReactionTf(tf: string): tf is ObLtfReactionTf {
  return (OB_REACTION_TFS as readonly string[]).includes(tf);
}

export function isEligibleObLtfPoi(poi: ObLtfPoi): boolean {
  if (poi.type === "D1_POI_OB") {
    return poi.state === "ACTIVE";
  }

  if (poi.type === "H4_CORE_OB") {
    return poi.state === "POI_ACTIVE";
  }

  return poi.state === "ACTIVE";
}

export function getObLtfGateBoundary(poi: ObLtfPoi): number {
  return poi.dir === "BULL" ? poi.zone.bottom : poi.zone.top;
}

export function getObLtfGatePriceExtreme(bar: ObBar, dir: Dir): number {
  return dir === "BULL" ? bar.low : bar.high;
}

export function computeObLtfGateDist(
  priceExtreme: number,
  boundary: number
): number {
  return Math.abs(priceExtreme - boundary);
}

type EvaluateObLtfGateOnBarArgs = {
  bar: ObBar;
  poi: ObLtfPoi;
  atrAtLtf: number;
};

export function evaluateObLtfGateOnBar(
  args: EvaluateObLtfGateOnBarArgs
): ObLtfGateEvalResult | null {
  const { bar, poi, atrAtLtf } = args;

  if (!isObLtfReactionTf(bar.tf)) return null;
  if (!isEligibleObLtfPoi(poi)) return null;
  if (!Number.isFinite(atrAtLtf) || atrAtLtf <= 0) return null;

  const boundary = getObLtfGateBoundary(poi);
  const priceExtreme = getObLtfGatePriceExtreme(bar, poi.dir);
  const dist = computeObLtfGateDist(priceExtreme, boundary);

  return {
    poiId: poi.id,
    poiType: poi.type,
    tf: bar.tf,
    dir: poi.dir,
    barCloseTime: bar.closeTime,
    boundary,
    priceExtreme,
    dist,
    atrAtLtf,
    passGate: dist <= atrAtLtf * LTF_GATE_ATR,
  };
}

export function evaluateObLtfGateFromTfBars(
  tfBars: readonly ObBar[],
  poi: ObLtfPoi
): ObLtfGateEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtLtf = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtLtf)) {
    return null;
  }

  return evaluateObLtfGateOnBar({
    bar: currentBar,
    poi,
    atrAtLtf: atrAtLtf as number,
  });
}

export function detectConfirmedObMicroPivotAtIndex(
  tfBars: readonly ObBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) return null;
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const center = tfBars[pivotIndex];
  if (!center) return null;
  if (!isObLtfReactionTf(center.tf)) return null;

  const leftStart = pivotIndex - LTF_MICRO_PIVOT_LEN;
  const rightEnd = pivotIndex + LTF_MICRO_PIVOT_LEN;

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

function getConfirmedMicroPivotsUpToTime(
  tfBars: readonly ObBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): Pivot[] {
  const out: Pivot[] = [];

  for (
    let pivotIndex = LTF_MICRO_PIVOT_LEN;
    pivotIndex <= tfBars.length - 1 - LTF_MICRO_PIVOT_LEN;
    pivotIndex += 1
  ) {
    const pivot = detectConfirmedObMicroPivotAtIndex(
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

export function getLatestConfirmedObMicroPivot(
  tfBars: readonly ObBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): Pivot | null {
  const pivots = getConfirmedMicroPivotsUpToTime(
    tfBars,
    pivotType,
    currentCloseTime
  );

  return pivots.length ? pivots[pivots.length - 1] : null;
}

function getLatestConfirmedObMicroPivotPair(
  tfBars: readonly ObBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): readonly [Pivot, Pivot] | null {
  const pivots = getConfirmedMicroPivotsUpToTime(
    tfBars,
    pivotType,
    currentCloseTime
  );

  if (pivots.length < 2) {
    return null;
  }

  return [pivots[pivots.length - 2], pivots[pivots.length - 1]];
}

type ResolveObLtfSweepRecoveryTargetArgs = {
  tfBars: readonly ObBar[];
  dir: Dir;
  currentCloseTime: number;
  atrAtEval: number;
};

export function resolveObLtfSweepRecoveryTarget(
  args: ResolveObLtfSweepRecoveryTargetArgs
): ObSweepRecoveryTarget | null {
  const { tfBars, dir, currentCloseTime, atrAtEval } = args;

  if (!Number.isFinite(atrAtEval) || atrAtEval <= 0) {
    return null;
  }

  if (dir === "BULL") {
    const pair = getLatestConfirmedObMicroPivotPair(
      tfBars,
      "LOW",
      currentCloseTime
    );

    if (pair) {
      const [p1, p2] = pair;

      if (Math.abs(p2.pivotPrice - p1.pivotPrice) <= atrAtEval * EQ_BAND_ATR) {
        return {
          targetType: "EQL",
          linePrice: Math.min(p1.pivotPrice, p2.pivotPrice),
          usedEqPair: true,
        };
      }
    }

    const fallback = getLatestConfirmedObMicroPivot(
      tfBars,
      "LOW",
      currentCloseTime
    );

    if (!fallback) return null;

    return {
      targetType: "SWING_LOW",
      linePrice: fallback.pivotPrice,
      usedEqPair: false,
    };
  }

  const pair = getLatestConfirmedObMicroPivotPair(
    tfBars,
    "HIGH",
    currentCloseTime
  );

  if (pair) {
    const [p1, p2] = pair;

    if (Math.abs(p2.pivotPrice - p1.pivotPrice) <= atrAtEval * EQ_BAND_ATR) {
      return {
        targetType: "EQH",
        linePrice: Math.max(p1.pivotPrice, p2.pivotPrice),
        usedEqPair: true,
      };
    }
  }

  const fallback = getLatestConfirmedObMicroPivot(
    tfBars,
    "HIGH",
    currentCloseTime
  );

  if (!fallback) return null;

  return {
    targetType: "SWING_HIGH",
    linePrice: fallback.pivotPrice,
    usedEqPair: false,
  };
}

export function evaluateObLtfChochTrigger(
  tfBars: readonly ObBar[],
  dir: Dir
): boolean {
  if (tfBars.length === 0) return false;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isObLtfReactionTf(currentBar.tf)) return false;

  if (dir === "BULL") {
    const pivotHigh = getLatestConfirmedObMicroPivot(
      tfBars,
      "HIGH",
      currentBar.closeTime
    );
    if (!pivotHigh) return false;

    return currentBar.close > pivotHigh.pivotPrice;
  }

  const pivotLow = getLatestConfirmedObMicroPivot(
    tfBars,
    "LOW",
    currentBar.closeTime
  );
  if (!pivotLow) return false;

  return currentBar.close < pivotLow.pivotPrice;
}

function isSweep(bar: ObBar, dir: Dir, linePrice: number): boolean {
  if (dir === "BULL") {
    return bar.low < linePrice;
  }

  return bar.high > linePrice;
}

function isRecovered(bar: ObBar, dir: Dir, linePrice: number): boolean {
  if (dir === "BULL") {
    return bar.close > linePrice;
  }

  return bar.close < linePrice;
}

export function evaluateObLtfSweepRecTrigger(
  tfBars: readonly ObBar[],
  dir: Dir
) {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const k = tfBars.length - 1;
  const currentBar = tfBars[k];
  if (!isObLtfReactionTf(currentBar.tf)) return null;

  const atrAtEval = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);
  if (!Number.isFinite(atrAtEval)) {
    return null;
  }

  const target = resolveObLtfSweepRecoveryTarget({
    tfBars,
    dir,
    currentCloseTime: currentBar.closeTime,
    atrAtEval: atrAtEval as number,
  });

  if (!target) {
    return {
      hasTarget: false,
      targetType: null,
      linePrice: null,
      usedEqPair: false,
      passSweepRecovery: false,
    };
  }

  for (let sweepIndex = Math.max(0, k - 2); sweepIndex <= k - 1; sweepIndex += 1) {
    for (
      let recoveryIndex = sweepIndex + 1;
      recoveryIndex <= Math.min(k, sweepIndex + LTF_SWEEP_RECOVERY_MAX_BARS);
      recoveryIndex += 1
    ) {
      if (recoveryIndex < k - 1) continue;

      const sweepBar = tfBars[sweepIndex];
      const recoveryBar = tfBars[recoveryIndex];

      if (!isSweep(sweepBar, dir, target.linePrice)) {
        continue;
      }

      if (!isRecovered(recoveryBar, dir, target.linePrice)) {
        continue;
      }

      return {
        hasTarget: true,
        targetType: target.targetType,
        linePrice: target.linePrice,
        usedEqPair: target.usedEqPair,
        sweepBarTime: sweepBar.closeTime,
        recoveryBarTime: recoveryBar.closeTime,
        passSweepRecovery: true,
      };
    }
  }

  return {
    hasTarget: true,
    targetType: target.targetType,
    linePrice: target.linePrice,
    usedEqPair: target.usedEqPair,
    passSweepRecovery: false,
  };
}

function computeOverlapLen(bar: ObBar, zone: Zone): number {
  return Math.max(
    0,
    Math.min(bar.high, zone.top) - Math.max(bar.low, zone.bottom)
  );
}

function findLatestObLtfBreakIndex(
  tfBars: readonly ObBar[],
  dir: Dir,
  maxIndex: number
): number | null {
  for (let i = maxIndex; i >= 0; i -= 1) {
    if (evaluateObLtfChochTrigger(tfBars.slice(0, i + 1), dir)) {
      return i;
    }
  }

  return null;
}

function getMicroObZoneFromBreakIndex(
  tfBars: readonly ObBar[],
  dir: Dir,
  breakIndex: number
): Zone | null {
  const start = Math.max(0, breakIndex - MICRO_OB_LOOKBACK_BARS);

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

function detectConfirmedMicroFvgAtEndIndex(
  tfBars: readonly ObBar[],
  endIndex: number
): DetectedObZoneCandidate | null {
  if (endIndex < 2) return null;

  const left = tfBars[endIndex - 2];
  const middle = tfBars[endIndex - 1];
  const right = tfBars[endIndex];

  if (!left || !middle || !right) return null;
  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!isObLtfReactionTf(right.tf)) return null;

  const atrAtConf = getAtrValueAtCloseTime(tfBars, right.closeTime);
  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  if (left.high < right.low) {
    const bottom = left.high;
    const top = right.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * MICRO_FVG_MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      triggerIndex: endIndex,
      obCandleIndex: endIndex - 2,
      triggerTime: right.closeTime,
      obCandleTime: left.closeTime,
      dir: "BULL",
      zone: { bottom, top, height },
    };
  }

  if (left.low > right.high) {
    const bottom = right.high;
    const top = left.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * MICRO_FVG_MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      triggerIndex: endIndex,
      obCandleIndex: endIndex - 2,
      triggerTime: right.closeTime,
      obCandleTime: left.closeTime,
      dir: "BEAR",
      zone: { bottom, top, height },
    };
  }

  return null;
}

function findLatestConfirmedMicroFvg(
  tfBars: readonly ObBar[],
  dir: Dir,
  maxEndIndex: number
): DetectedObZoneCandidate | null {
  for (let endIndex = maxEndIndex; endIndex >= 2; endIndex -= 1) {
    const candidate = detectConfirmedMicroFvgAtEndIndex(tfBars, endIndex);
    if (candidate && candidate.dir === dir) {
      return candidate;
    }
  }

  return null;
}

export function evaluateObMicroRetestMicroObTrigger(
  tfBars: readonly ObBar[],
  dir: Dir
): ObLtfMicroRetestType | null {
  if (tfBars.length < 2) return null;

  assertSameTfAscending(tfBars);

  const k = tfBars.length - 1;
  const touchBar = tfBars[k - 1];
  const confirmBar = tfBars[k];

  if (!isObLtfReactionTf(confirmBar.tf)) return null;

  const breakIndex = findLatestObLtfBreakIndex(tfBars, dir, k - 2);
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
      ? confirmBar.close > zone.top
      : confirmBar.close < zone.bottom;

  return touchOk && confirmOk ? "MR_MICRO_OB" : null;
}

export function evaluateObMicroRetestMicroFvgTrigger(
  tfBars: readonly ObBar[],
  dir: Dir
): ObLtfMicroRetestType | null {
  if (tfBars.length < 2) return null;

  assertSameTfAscending(tfBars);

  const k = tfBars.length - 1;
  const touchBar = tfBars[k - 1];
  const confirmBar = tfBars[k];

  if (!isObLtfReactionTf(confirmBar.tf)) return null;

  const microFvg = findLatestConfirmedMicroFvg(tfBars, dir, k - 2);
  if (!microFvg) {
    return null;
  }

  const boundary =
    dir === "BULL" ? microFvg.zone.bottom : microFvg.zone.top;

  const touchOk =
    dir === "BULL"
      ? touchBar.low <= boundary
      : touchBar.high >= boundary;

  const confirmOk =
    dir === "BULL"
      ? confirmBar.close > boundary
      : confirmBar.close < boundary;

  return touchOk && confirmOk ? "MR_MICRO_FVG" : null;
}

export function sortUniqueObLtfTriggerTokens(
  tokens: readonly ObLtfTriggerToken[]
): ObLtfTriggerToken[] {
  return uniqueLexicographicTags(tokens) as ObLtfTriggerToken[];
}

export function evaluateObLtfTriggers(
  tfBars: readonly ObBar[],
  poi: ObLtfPoi
): ObLtfTriggerEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isObLtfReactionTf(currentBar.tf)) return null;
  if (!isEligibleObLtfPoi(poi)) return null;

  const choch = evaluateObLtfChochTrigger(tfBars, poi.dir);
  const sweepRecEval = evaluateObLtfSweepRecTrigger(tfBars, poi.dir);

  const microRetestTypes = [
    evaluateObMicroRetestMicroObTrigger(tfBars, poi.dir),
    evaluateObMicroRetestMicroFvgTrigger(tfBars, poi.dir),
  ].filter((token): token is ObLtfMicroRetestType => Boolean(token));

  const tokens: ObLtfTriggerToken[] = [];

  if (choch) {
    tokens.push("CHOCH");
  }

  if (sweepRecEval?.passSweepRecovery) {
    tokens.push("SWEEP_REC");
  }

  tokens.push(...microRetestTypes);

  return {
    tf: currentBar.tf,
    dir: poi.dir,
    barCloseTime: currentBar.closeTime,
    choch,
    sweepRec: Boolean(sweepRecEval?.passSweepRecovery),
    microRetestTypes: uniqueLexicographicTags(
      microRetestTypes
    ) as ObLtfMicroRetestType[],
    tokens: sortUniqueObLtfTriggerTokens(tokens),
  };
}
