import {
  CONTEXT_DIST_ATR,
  CONTEXT_TIGHT_ATR,
  DISP_BODY_MAX_ATR,
  DISP_BODY_SUM_ATR,
  EQ_BAND_ATR,
  SWEEP_WINDOW_BARS,
} from "./constants";
import type {
  Dir,
  ObBar,
  ObContextDistanceEvalResult,
  ObContextSource,
  ObDisplacementEvalResult,
  ObSweepRecoveryEvalResult,
  ObSweepRecoveryTarget,
  Pivot,
} from "./types";

function assertSameTfAscending(bars: readonly ObBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("OB filter bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("OB filter bars must be strictly ascending by closeTime");
    }
  }
}

export function getObCandleBodySize(bar: ObBar): number {
  return Math.abs(bar.close - bar.open);
}

type EvaluateObDisplacementAtTriggerArgs = {
  tfBars: readonly ObBar[];
  triggerIndex: number;
  atrAtTrigger: number;
};

export function evaluateObDisplacementAtTrigger(
  args: EvaluateObDisplacementAtTriggerArgs
): ObDisplacementEvalResult | null {
  const { tfBars, triggerIndex, atrAtTrigger } = args;

  if (!Number.isInteger(triggerIndex)) return null;
  if (triggerIndex < 2 || triggerIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtTrigger) || atrAtTrigger <= 0) return null;

  assertSameTfAscending(tfBars);

  const bars = tfBars.slice(triggerIndex - 2, triggerIndex + 1);
  const bodies = bars.map(getObCandleBodySize);

  const bodyMax = Math.max(...bodies);
  const bodySum = bodies.reduce((sum, v) => sum + v, 0);

  const passByMax = bodyMax > atrAtTrigger * DISP_BODY_MAX_ATR;
  const passBySum = bodySum > atrAtTrigger * DISP_BODY_SUM_ATR;

  return {
    triggerIndex,
    triggerTime: tfBars[triggerIndex].closeTime,
    atrAtTrigger,
    bodyMax,
    bodySum,
    passByMax,
    passBySum,
    passDisplacement: passByMax || passBySum,
  };
}

type ResolveObSweepRecoveryTargetArgs = {
  dir: Dir;
  atrAtTrigger: number;
  eqPivotPair?: readonly [Pivot, Pivot];
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function resolveObSweepRecoveryTarget(
  args: ResolveObSweepRecoveryTargetArgs
): ObSweepRecoveryTarget | null {
  const {
    dir,
    atrAtTrigger,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  if (!Number.isFinite(atrAtTrigger) || atrAtTrigger <= 0) {
    return null;
  }

  if (dir === "BULL") {
    if (
      eqPivotPair &&
      eqPivotPair[0].pivotType === "LOW" &&
      eqPivotPair[1].pivotType === "LOW" &&
      eqPivotPair[0].isConfirmed &&
      eqPivotPair[1].isConfirmed &&
      Math.abs(eqPivotPair[1].pivotPrice - eqPivotPair[0].pivotPrice) <=
        atrAtTrigger * EQ_BAND_ATR
    ) {
      return {
        targetType: "EQL",
        linePrice: Math.min(eqPivotPair[0].pivotPrice, eqPivotPair[1].pivotPrice),
        usedEqPair: true,
      };
    }

    if (!lastConfirmedPivotLow || !lastConfirmedPivotLow.isConfirmed) {
      return null;
    }

    return {
      targetType: "SWING_LOW",
      linePrice: lastConfirmedPivotLow.pivotPrice,
      usedEqPair: false,
    };
  }

  if (
    eqPivotPair &&
    eqPivotPair[0].pivotType === "HIGH" &&
    eqPivotPair[1].pivotType === "HIGH" &&
    eqPivotPair[0].isConfirmed &&
    eqPivotPair[1].isConfirmed &&
    Math.abs(eqPivotPair[1].pivotPrice - eqPivotPair[0].pivotPrice) <=
      atrAtTrigger * EQ_BAND_ATR
  ) {
    return {
      targetType: "EQH",
      linePrice: Math.max(eqPivotPair[0].pivotPrice, eqPivotPair[1].pivotPrice),
      usedEqPair: true,
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

function isSweep(bar: ObBar, dir: Dir, linePrice: number): boolean {
  if (dir === "BULL") {
    return bar.low < linePrice;
  }

  return bar.high > linePrice;
}

function isRecovered(nextBar: ObBar, dir: Dir, linePrice: number): boolean {
  if (dir === "BULL") {
    return nextBar.close > linePrice;
  }

  return nextBar.close < linePrice;
}

type EvaluateObSweepRecoveryAtTriggerArgs = {
  tfBars: readonly ObBar[];
  triggerIndex: number;
  dir: Dir;
  atrAtTrigger: number;
  eqPivotPair?: readonly [Pivot, Pivot];
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function evaluateObSweepRecoveryAtTrigger(
  args: EvaluateObSweepRecoveryAtTriggerArgs
): ObSweepRecoveryEvalResult | null {
  const {
    tfBars,
    triggerIndex,
    dir,
    atrAtTrigger,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  if (!Number.isInteger(triggerIndex)) return null;
  if (triggerIndex < 0 || triggerIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtTrigger) || atrAtTrigger <= 0) return null;

  assertSameTfAscending(tfBars);

  const target = resolveObSweepRecoveryTarget({
    dir,
    atrAtTrigger,
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

  const start = Math.max(0, triggerIndex - SWEEP_WINDOW_BARS);

  for (let sweepIndex = triggerIndex - 1; sweepIndex >= start; sweepIndex -= 1) {
    const recoveryIndex = sweepIndex + 1;
    if (recoveryIndex > triggerIndex) {
      continue;
    }

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

  return {
    hasTarget: true,
    targetType: target.targetType,
    linePrice: target.linePrice,
    usedEqPair: target.usedEqPair,
    passSweepRecovery: false,
  };
}

export function selectPreferredObContextDistance(
  channelDistance?: number | null,
  trendlineDistance?: number | null
): { source: ObContextSource; distance: number | null } {
  if (Number.isFinite(channelDistance)) {
    return {
      source: "CHANNEL",
      distance: channelDistance as number,
    };
  }

  if (Number.isFinite(trendlineDistance)) {
    return {
      source: "TRENDLINE",
      distance: trendlineDistance as number,
    };
  }

  return {
    source: "NONE",
    distance: null,
  };
}

type EvaluateObContextDistanceFilterArgs = {
  atrAtTrigger: number;
  channelDistance?: number | null;
  trendlineDistance?: number | null;
};

export function evaluateObContextDistanceFilter(
  args: EvaluateObContextDistanceFilterArgs
): ObContextDistanceEvalResult | null {
  const { atrAtTrigger, channelDistance, trendlineDistance } = args;

  if (!Number.isFinite(atrAtTrigger) || atrAtTrigger <= 0) {
    return null;
  }

  const selected = selectPreferredObContextDistance(
    channelDistance,
    trendlineDistance
  );

  if (selected.source === "NONE" || selected.distance === null) {
    return {
      source: "NONE",
      distance: null,
      atrAtTrigger,
      passContextDist: false,
      passContextTight: false,
    };
  }

  return {
    source: selected.source,
    distance: selected.distance,
    atrAtTrigger,
    passContextDist: selected.distance <= atrAtTrigger * CONTEXT_DIST_ATR,
    passContextTight: selected.distance <= atrAtTrigger * CONTEXT_TIGHT_ATR,
  };
}
