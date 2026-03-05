import { EQH_EQL_ATR_RATIO } from "./constants";
import { getAtrValueAtConfTime } from "./atr";
import type {
  Dir,
  FvgBar,
  Pivot,
  SweepRecoveryEvalResult,
  SweepRecoveryTarget,
} from "./types";

const SWEEP_WINDOW_BEFORE_CONF_BARS = 3;
const SWEEP_WINDOW_AFTER_CONF_SWEEP_BARS = 2;

function assertSameTfAscending(bars: readonly FvgBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Sweep/recovery bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Sweep/recovery bars must be strictly ascending by closeTime");
    }
  }
}

function buildEqualTarget(
  dir: Dir,
  atrAtConf: number,
  eqPivotPair?: readonly [Pivot, Pivot]
): SweepRecoveryTarget | null {
  if (!eqPivotPair) return null;
  if (!Number.isFinite(atrAtConf) || atrAtConf <= 0) return null;

  const [p1, p2] = eqPivotPair;

  if (!p1.isConfirmed || !p2.isConfirmed) {
    return null;
  }

  const diff = Math.abs(p2.pivotPrice - p1.pivotPrice);
  if (diff > atrAtConf * EQH_EQL_ATR_RATIO) {
    return null;
  }

  if (dir === "BULL") {
    if (p1.pivotType !== "LOW" || p2.pivotType !== "LOW") {
      return null;
    }

    return {
      targetType: "EQL",
      linePrice: Math.min(p1.pivotPrice, p2.pivotPrice),
      usedEqPair: true,
    };
  }

  if (p1.pivotType !== "HIGH" || p2.pivotType !== "HIGH") {
    return null;
  }

  return {
    targetType: "EQH",
    linePrice: Math.max(p1.pivotPrice, p2.pivotPrice),
    usedEqPair: true,
  };
}

function buildFallbackTarget(
  dir: Dir,
  lastConfirmedPivotHigh?: Pivot,
  lastConfirmedPivotLow?: Pivot
): SweepRecoveryTarget | null {
  if (dir === "BULL") {
    if (!lastConfirmedPivotLow || !lastConfirmedPivotLow.isConfirmed) {
      return null;
    }

    return {
      targetType: "SWING_LOW",
      linePrice: lastConfirmedPivotLow.pivotPrice,
      usedEqPair: false,
    };
  }

  if (!lastConfirmedPivotHigh || !lastConfirmedPivotHigh.isConfirmed) {
    return null;
  }

  return {
    targetType: "SWING_HIGH",
    linePrice: lastConfirmedPivotHigh.pivotPrice,
    usedEqPair: false,
  };
}

type ResolveSweepRecoveryTargetArgs = {
  dir: Dir;
  atrAtConf: number;
  eqPivotPair?: readonly [Pivot, Pivot];
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function resolveSweepRecoveryTarget(
  args: ResolveSweepRecoveryTargetArgs
): SweepRecoveryTarget | null {
  const {
    dir,
    atrAtConf,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  const eqTarget = buildEqualTarget(dir, atrAtConf, eqPivotPair);
  if (eqTarget) {
    return eqTarget;
  }

  return buildFallbackTarget(dir, lastConfirmedPivotHigh, lastConfirmedPivotLow);
}

function isSweep(bar: FvgBar, dir: Dir, linePrice: number): boolean {
  if (dir === "BULL") {
    return bar.low < linePrice;
  }

  return bar.high > linePrice;
}

function isRecoveredByNextClose(
  nextBar: FvgBar,
  dir: Dir,
  linePrice: number
): boolean {
  if (dir === "BULL") {
    return nextBar.close > linePrice;
  }

  return nextBar.close < linePrice;
}

type EvaluateSweepRecoveryFromTfBarsArgs = {
  tfBars: readonly FvgBar[];
  confIndex: number;
  dir: Dir;
  eqPivotPair?: readonly [Pivot, Pivot];
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function evaluateSweepRecoveryFromTfBars(
  args: EvaluateSweepRecoveryFromTfBarsArgs
): SweepRecoveryEvalResult | null {
  const {
    tfBars,
    confIndex,
    dir,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  if (!Number.isInteger(confIndex)) return null;
  if (confIndex < 0 || confIndex >= tfBars.length) return null;

  assertSameTfAscending(tfBars);

  const confBar = tfBars[confIndex];
  const atrAtConf = getAtrValueAtConfTime(tfBars, confBar.closeTime);

  if (!Number.isFinite(atrAtConf)) {
    return null;
  }

  const target = resolveSweepRecoveryTarget({
    dir,
    atrAtConf: atrAtConf as number,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
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

  const sweepStartIndex = Math.max(0, confIndex - SWEEP_WINDOW_BEFORE_CONF_BARS);
  const sweepEndIndex = Math.min(
    tfBars.length - 2,
    confIndex + SWEEP_WINDOW_AFTER_CONF_SWEEP_BARS
  );

  for (let i = sweepStartIndex; i <= sweepEndIndex; i += 1) {
    const sweepBar = tfBars[i];
    const recoveryBar = tfBars[i + 1];

    if (!isSweep(sweepBar, dir, target.linePrice)) {
      continue;
    }

    if (!isRecoveredByNextClose(recoveryBar, dir, target.linePrice)) {
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

  return {
    hasTarget: true,
    targetType: target.targetType,
    linePrice: target.linePrice,
    usedEqPair: target.usedEqPair,
    passSweepRecovery: false,
  };
}
