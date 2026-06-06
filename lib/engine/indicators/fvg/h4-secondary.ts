import { H4_F2_F3_RANGE_BARS } from "./constants";
import { evaluateSweepRecoveryFromTfBars } from "./sweep-recovery";
import type {
  Dir,
  FvgBar,
  Pivot,
  StructureBreakType,
  StructureState,
  SweepRecoveryEvalResult,
  Timestamp,
} from "./types";

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

export interface H4StructureBreakSnapshot {
  tf: "H4";
  closeTime: Timestamp;
  nextState: StructureState;
  breakType: StructureBreakType | null;
}

function getH4SecondaryWindowStart(confTime: Timestamp): Timestamp {
  return confTime - H4_F2_F3_RANGE_BARS * H4_BAR_DURATION_MS;
}

function getH4SecondaryWindowEnd(
  confTime: Timestamp,
  currentCloseTime: Timestamp
): Timestamp {
  return Math.min(
    currentCloseTime,
    confTime + H4_F2_F3_RANGE_BARS * H4_BAR_DURATION_MS
  );
}

function isSameDirectionBreak(
  snapshot: H4StructureBreakSnapshot,
  dir: Dir
): boolean {
  if (snapshot.tf !== "H4") return false;
  if (snapshot.breakType !== "BOS" && snapshot.breakType !== "CHOCH") {
    return false;
  }

  if (dir === "BULL") {
    return snapshot.nextState === "UP";
  }

  return snapshot.nextState === "DOWN";
}

type EvaluateH4CoreFvgF2Args = {
  dir: Dir;
  confTime: Timestamp;
  currentCloseTime: Timestamp;
  structureBreaks: readonly H4StructureBreakSnapshot[];
};

export function evaluateH4CoreFvgPassF2(
  args: EvaluateH4CoreFvgF2Args
): boolean {
  const { dir, confTime, currentCloseTime, structureBreaks } = args;

  const windowStart = getH4SecondaryWindowStart(confTime);
  const windowEnd = getH4SecondaryWindowEnd(confTime, currentCloseTime);

  return structureBreaks.some(
    (snapshot) =>
      isSameDirectionBreak(snapshot, dir) &&
      snapshot.closeTime >= windowStart &&
      snapshot.closeTime <= windowEnd
  );
}

function findBarIndexByCloseTime(
  bars: readonly FvgBar[],
  closeTime: Timestamp
): number {
  return bars.findIndex((bar) => bar.tf === "H4" && bar.closeTime === closeTime);
}

function getObservedH4Bars(
  bars: readonly FvgBar[],
  currentCloseTime: Timestamp
): readonly FvgBar[] {
  return bars.filter(
    (bar) => bar.tf === "H4" && bar.closeTime <= currentCloseTime
  );
}

type EvaluateH4CoreFvgF3Args = {
  tfBars: readonly FvgBar[];
  dir: Dir;
  confTime: Timestamp;
  currentCloseTime: Timestamp;
  eqPivotPair?: readonly [Pivot, Pivot];
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function evaluateH4CoreFvgPassF3(
  args: EvaluateH4CoreFvgF3Args
): boolean {
  const {
    tfBars,
    dir,
    confTime,
    currentCloseTime,
    eqPivotPair,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  const observedBars = getObservedH4Bars(tfBars, currentCloseTime);
  const confIndex = findBarIndexByCloseTime(observedBars, confTime);

  if (confIndex < 0) {
    return false;
  }

  const evaluation: SweepRecoveryEvalResult | null = evaluateSweepRecoveryFromTfBars(
    {
      tfBars: observedBars,
      confIndex,
      dir,
      eqPivotPair,
      lastConfirmedPivotHigh,
      lastConfirmedPivotLow,
    }
  );

  return Boolean(evaluation?.passSweepRecovery);
}
