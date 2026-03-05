import type {
  Pivot,
  StructureEvalResult,
  StructureState,
} from "./types";

type EvaluateStructureAtCloseArgs = {
  prevState: StructureState;
  close: number;
  lastConfirmedPivotHigh?: Pivot;
  lastConfirmedPivotLow?: Pivot;
};

export function evaluateStructureAtClose(
  args: EvaluateStructureAtCloseArgs
): StructureEvalResult {
  const {
    prevState,
    close,
    lastConfirmedPivotHigh,
    lastConfirmedPivotLow,
  } = args;

  if (!lastConfirmedPivotHigh || !lastConfirmedPivotLow) {
    return {
      structureReady: false,
      prevState,
      nextState: "MIXED",
      breakType: null,
    };
  }

  const pivotHigh = lastConfirmedPivotHigh.pivotPrice;
  const pivotLow = lastConfirmedPivotLow.pivotPrice;

  if (prevState === "MIXED") {
    if (close > pivotHigh) {
      return {
        structureReady: true,
        prevState,
        nextState: "UP",
        breakType: "BOS",
      };
    }

    if (close < pivotLow) {
      return {
        structureReady: true,
        prevState,
        nextState: "DOWN",
        breakType: "BOS",
      };
    }

    return {
      structureReady: true,
      prevState,
      nextState: "MIXED",
      breakType: null,
    };
  }

  if (prevState === "UP") {
    if (close > pivotHigh) {
      return {
        structureReady: true,
        prevState,
        nextState: "UP",
        breakType: "BOS",
      };
    }

    if (close < pivotLow) {
      return {
        structureReady: true,
        prevState,
        nextState: "DOWN",
        breakType: "CHOCH",
      };
    }

    return {
      structureReady: true,
      prevState,
      nextState: "UP",
      breakType: null,
    };
  }

  if (close < pivotLow) {
    return {
      structureReady: true,
      prevState,
      nextState: "DOWN",
      breakType: "BOS",
    };
  }

  if (close > pivotHigh) {
    return {
      structureReady: true,
      prevState,
      nextState: "UP",
      breakType: "CHOCH",
    };
  }

  return {
    structureReady: true,
    prevState,
    nextState: "DOWN",
    breakType: null,
  };
}
