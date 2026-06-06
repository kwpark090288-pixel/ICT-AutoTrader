import { uniqueLexicographicTags } from "../../tags";
import { getAtrValueAtConfTime } from "./atr";
import {
  EQH_EQL_ATR_RATIO,
  FVG_REACTION_TFS,
  LTF_GATE_ATR,
  LTF_MICRO_PIVOT_LEN,
  LTF_SWEEP_RECOVERY_MAX_BARS,
  MICRO_OB_LOOKBACK_BARS,
  MIN_ZONE_HEIGHT_ATR,
} from "./constants";
import { isEligibleLtfGatePoi } from "./ltf-gate";
import type {
  D1PoiFvg,
  DetectedWickFvg,
  Dir,
  FvgBar,
  H4CoreFvg,
  LtfTriggerEvalResult,
  MicroRetestType,
  Pivot,
  ReactionTriggerToken,
  SetupFvg,
  SweepRecoveryEvalResult,
  SweepRecoveryTarget,
  Zone,
} from "./types";

export type LtfTriggerPoi = D1PoiFvg | H4CoreFvg | SetupFvg;
export type LtfTriggerTf = "M15" | "M5";

function assertSameTfAscending(bars: readonly FvgBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("LTF trigger bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("LTF trigger bars must be strictly ascending by closeTime");
    }
  }
}

export function isLtfTriggerTf(tf: string): tf is LtfTriggerTf {
  return (FVG_REACTION_TFS as readonly string[]).includes(tf);
}

export function detectConfirmedMicroPivotAtIndex(
  tfBars: readonly FvgBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) return null;
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const center = tfBars[pivotIndex];
  if (!center) return null;
  if (!isLtfTriggerTf(center.tf)) return null;

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
  tfBars: readonly FvgBar[],
  pivotType: "HIGH" | "LOW",
  currentCloseTime: number
): Pivot[] {
  const out: Pivot[] = [];

  for (
    let pivotIndex = LTF_MICRO_PIVOT_LEN;
    pivotIndex <= tfBars.length - 1 - LTF_MICRO_PIVOT_LEN;
    pivotIndex += 1
  ) {
    const pivot = detectConfirmedMicroPivotAtIndex(tfBars, pivotType, pivotIndex);
    if (!pivot) continue;
    if (pivot.confirmedAt <= currentCloseTime) {
      out.push(pivot);
    }
  }

  return out;
}

export function getLatestConfirmedMicroPivot(
  tfBars: readonly FvgBar[],
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

function getLatestConfirmedMicroPivotPair(
  tfBars: readonly FvgBar[],
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

type ResolveLtfSweepRecoveryTargetArgs = {
  tfBars: readonly FvgBar[];
  dir: Dir;
  currentCloseTime: number;
  atrAtEval: number;
};

export function resolveLtfSweepRecoveryTarget(
  args: ResolveLtfSweepRecoveryTargetArgs
): SweepRecoveryTarget | null {
  const { tfBars, dir, currentCloseTime, atrAtEval } = args;

  if (!Number.isFinite(atrAtEval) || atrAtEval <= 0) {
    return null;
  }

  if (dir === "BULL") {
    const pair = getLatestConfirmedMicroPivotPair(
      tfBars,
      "LOW",
      currentCloseTime
    );

    if (pair) {
      const [p1, p2] = pair;
      if (Math.abs(p2.pivotPrice - p1.pivotPrice) <= atrAtEval * EQH_EQL_ATR_RATIO) {
        return {
          targetType: "EQL",
          linePrice: Math.min(p1.pivotPrice, p2.pivotPrice),
          usedEqPair: true,
        };
      }
    }

    const fallback = getLatestConfirmedMicroPivot(
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

  const pair = getLatestConfirmedMicroPivotPair(
    tfBars,
    "HIGH",
    currentCloseTime
  );

  if (pair) {
    const [p1, p2] = pair;
    if (Math.abs(p2.pivotPrice - p1.pivotPrice) <= atrAtEval * EQH_EQL_ATR_RATIO) {
      return {
        targetType: "EQH",
        linePrice: Math.max(p1.pivotPrice, p2.pivotPrice),
        usedEqPair: true,
      };
    }
  }

  const fallback = getLatestConfirmedMicroPivot(
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

export function evaluateLtfChochTrigger(
  tfBars: readonly FvgBar[],
  dir: Dir
): boolean {
  if (tfBars.length === 0) return false;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isLtfTriggerTf(currentBar.tf)) return false;

  if (dir === "BULL") {
    const pivotHigh = getLatestConfirmedMicroPivot(
      tfBars,
      "HIGH",
      currentBar.closeTime
    );
    if (!pivotHigh) return false;

    return currentBar.close > pivotHigh.pivotPrice;
  }

  const pivotLow = getLatestConfirmedMicroPivot(
    tfBars,
    "LOW",
    currentBar.closeTime
  );
  if (!pivotLow) return false;

  return currentBar.close < pivotLow.pivotPrice;
}

function isSweepForTarget(
  sweepBar: FvgBar,
  dir: Dir,
  linePrice: number
): boolean {
  if (dir === "BULL") {
    return sweepBar.low < linePrice;
  }

  return sweepBar.high > linePrice;
}

function isRecoveredForTarget(
  recoveryBar: FvgBar,
  dir: Dir,
  linePrice: number
): boolean {
  if (dir === "BULL") {
    return recoveryBar.close > linePrice;
  }

  return recoveryBar.close < linePrice;
}

export function evaluateLtfSweepRecTrigger(
  tfBars: readonly FvgBar[],
  dir: Dir
): SweepRecoveryEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isLtfTriggerTf(currentBar.tf)) return null;

  const atrAtEval = getAtrValueAtConfTime(tfBars, currentBar.closeTime);
  if (!Number.isFinite(atrAtEval)) {
    return null;
  }

  const target = resolveLtfSweepRecoveryTarget({
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

  const lastIndex = tfBars.length - 1;
  const recoveryStart = Math.max(0, lastIndex - 1);

  for (let recoveryIndex = recoveryStart; recoveryIndex <= lastIndex; recoveryIndex += 1) {
    const recoveryBar = tfBars[recoveryIndex];

    for (
      let sweepIndex = Math.max(lastIndex - 2, recoveryIndex - LTF_SWEEP_RECOVERY_MAX_BARS);
      sweepIndex <= recoveryIndex - 1;
      sweepIndex += 1
    ) {
      const sweepBar = tfBars[sweepIndex];
      if (!sweepBar) continue;

      if (!isSweepForTarget(sweepBar, dir, target.linePrice)) {
        continue;
      }

      if (!isRecoveredForTarget(recoveryBar, dir, target.linePrice)) {
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

function hasStrictZoneEntry(bar: FvgBar, zone: Zone): boolean {
  return Math.min(bar.high, zone.top) > Math.max(bar.low, zone.bottom);
}

function detectMicroFvgAtEndIndex(
  tfBars: readonly FvgBar[],
  endIndex: number
): DetectedWickFvg | null {
  if (endIndex < 2) return null;

  const left = tfBars[endIndex - 2];
  const middle = tfBars[endIndex - 1];
  const right = tfBars[endIndex];

  if (!left || !middle || !right) return null;
  if (left.tf !== middle.tf || middle.tf !== right.tf) return null;
  if (!isLtfTriggerTf(right.tf)) return null;

  const atrAtConf = getAtrValueAtConfTime(tfBars, right.closeTime);
  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  if (left.high < right.low) {
    const bottom = left.high;
    const top = right.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      tf: right.tf,
      dir: "BULL",
      leftCloseTime: left.closeTime,
      middleCloseTime: middle.closeTime,
      rightCloseTime: right.closeTime,
      confTime: right.closeTime,
      atrAtConf: atrAtConf as number,
      zone: { bottom, top, height },
    };
  }

  if (left.low > right.high) {
    const bottom = right.high;
    const top = left.low;
    const height = top - bottom;

    if (height < (atrAtConf as number) * MIN_ZONE_HEIGHT_ATR) {
      return null;
    }

    return {
      tf: right.tf,
      dir: "BEAR",
      leftCloseTime: left.closeTime,
      middleCloseTime: middle.closeTime,
      rightCloseTime: right.closeTime,
      confTime: right.closeTime,
      atrAtConf: atrAtConf as number,
      zone: { bottom, top, height },
    };
  }

  return null;
}

function findLatestConfirmedMicroFvg(
  tfBars: readonly FvgBar[],
  maxEndIndex: number
): DetectedWickFvg | null {
  for (let endIndex = maxEndIndex; endIndex >= 2; endIndex -= 1) {
    const candidate = detectMicroFvgAtEndIndex(tfBars, endIndex);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function findLatestImmediateBreakBarIndex(
  tfBars: readonly FvgBar[],
  dir: Dir,
  upToIndex: number
): number | null {
  for (let i = upToIndex; i >= 0; i -= 1) {
    if (evaluateLtfChochTrigger(tfBars.slice(0, i + 1), dir)) {
      return i;
    }
  }

  return null;
}

function getMicroObZoneFromBreakIndex(
  tfBars: readonly FvgBar[],
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

export function evaluateMicroRetestBoundaryTrigger(
  tfBars: readonly FvgBar[],
  poi: LtfTriggerPoi
): MicroRetestType | null {
  if (tfBars.length < 2) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const touchBar = tfBars[tfBars.length - 2];

  if (!isLtfTriggerTf(currentBar.tf)) return null;

  const atrAtEval = getAtrValueAtConfTime(tfBars, currentBar.closeTime);
  if (!Number.isFinite(atrAtEval)) {
    return null;
  }

  const boundary = poi.dir === "BULL" ? poi.zone.bottom : poi.zone.top;
  const priceExtreme = poi.dir === "BULL" ? touchBar.low : touchBar.high;

  const touchOk =
    poi.dir === "BULL"
      ? priceExtreme <= boundary &&
        Math.abs(priceExtreme - boundary) <= (atrAtEval as number) * LTF_GATE_ATR
      : priceExtreme >= boundary &&
        Math.abs(priceExtreme - boundary) <= (atrAtEval as number) * LTF_GATE_ATR;

  const confirmOk =
    poi.dir === "BULL"
      ? currentBar.close > boundary
      : currentBar.close < boundary;

  return touchOk && confirmOk ? "MR_FVG_BOUNDARY" : null;
}

export function evaluateMicroRetestMicroObTrigger(
  tfBars: readonly FvgBar[],
  dir: Dir
): MicroRetestType | null {
  if (tfBars.length < 2) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const touchBar = tfBars[tfBars.length - 2];

  if (!isLtfTriggerTf(currentBar.tf)) return null;

  const breakIndex = findLatestImmediateBreakBarIndex(
    tfBars,
    dir,
    tfBars.length - 3
  );

  if (breakIndex === null) {
    return null;
  }

  const zone = getMicroObZoneFromBreakIndex(tfBars, dir, breakIndex);
  if (!zone || !(zone.top > zone.bottom)) {
    return null;
  }

  const touchOk = hasStrictZoneEntry(touchBar, zone);
  const confirmOk =
    dir === "BULL"
      ? currentBar.close > zone.top
      : currentBar.close < zone.bottom;

  return touchOk && confirmOk ? "MR_MICRO_OB" : null;
}

export function evaluateMicroRetestMicroFvgTrigger(
  tfBars: readonly FvgBar[],
  dir: Dir
): MicroRetestType | null {
  if (tfBars.length < 2) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const touchBar = tfBars[tfBars.length - 2];

  if (!isLtfTriggerTf(currentBar.tf)) return null;

  const microFvg = findLatestConfirmedMicroFvg(tfBars, tfBars.length - 3);
  if (!microFvg || microFvg.dir !== dir) {
    return null;
  }

  const touchOk =
    dir === "BULL"
      ? touchBar.low <= microFvg.zone.bottom
      : touchBar.high >= microFvg.zone.top;

  const confirmOk =
    dir === "BULL"
      ? currentBar.close > microFvg.zone.bottom
      : currentBar.close < microFvg.zone.top;

  return touchOk && confirmOk ? "MR_MICRO_FVG" : null;
}

export function sortUniqueLtfTriggerTokens(
  tokens: readonly ReactionTriggerToken[]
): ReactionTriggerToken[] {
  return uniqueLexicographicTags(tokens) as ReactionTriggerToken[];
}

export function evaluateLtfTriggers(
  tfBars: readonly FvgBar[],
  poi: LtfTriggerPoi
): LtfTriggerEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  if (!isLtfTriggerTf(currentBar.tf)) return null;
  if (!isEligibleLtfGatePoi(poi)) return null;

  const choch = evaluateLtfChochTrigger(tfBars, poi.dir);
  const sweepRecEval = evaluateLtfSweepRecTrigger(tfBars, poi.dir);

  const microRetestTypes = [
    evaluateMicroRetestBoundaryTrigger(tfBars, poi),
    evaluateMicroRetestMicroObTrigger(tfBars, poi.dir),
    evaluateMicroRetestMicroFvgTrigger(tfBars, poi.dir),
  ].filter((token): token is MicroRetestType => Boolean(token));

  const tokens: ReactionTriggerToken[] = [];

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
    ) as MicroRetestType[],
    tokens: sortUniqueLtfTriggerTokens(tokens),
  };
}
