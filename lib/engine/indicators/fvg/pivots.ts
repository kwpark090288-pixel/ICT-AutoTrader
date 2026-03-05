import { FVG_CONTEXT_TFS, FVG_PIVOT_LEN } from "./constants";
import type { FvgBar, Pivot, PivotType } from "./types";

type PivotStructureTf = "D1" | "H4";

export function isPivotStructureTf(tf: string): tf is PivotStructureTf {
  return (FVG_CONTEXT_TFS as readonly string[]).includes(tf);
}

function assertSameTfAscending(bars: readonly FvgBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Pivot bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Pivot bars must be strictly ascending by closeTime");
    }
  }
}

export function detectConfirmedFractalPivotAtIndex(
  bars: readonly FvgBar[],
  pivotType: PivotType,
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) return null;
  if (bars.length === 0) return null;

  assertSameTfAscending(bars);

  const center = bars[pivotIndex];
  if (!center) return null;
  if (!isPivotStructureTf(center.tf)) return null;

  const leftStart = pivotIndex - FVG_PIVOT_LEN;
  const rightEnd = pivotIndex + FVG_PIVOT_LEN;

  if (leftStart < 0) return null;
  if (rightEnd >= bars.length) return null;

  if (pivotType === "HIGH") {
    for (let i = leftStart; i <= rightEnd; i += 1) {
      if (i === pivotIndex) continue;
      if (center.high <= bars[i].high) {
        return null;
      }
    }

    return {
      tf: center.tf,
      pivotType: "HIGH",
      pivotTime: center.closeTime,
      pivotPrice: center.high,
      confirmedAt: bars[rightEnd].closeTime,
      isConfirmed: true,
    };
  }

  for (let i = leftStart; i <= rightEnd; i += 1) {
    if (i === pivotIndex) continue;
    if (center.low >= bars[i].low) {
      return null;
    }
  }

  return {
    tf: center.tf,
    pivotType: "LOW",
    pivotTime: center.closeTime,
    pivotPrice: center.low,
    confirmedAt: bars[rightEnd].closeTime,
    isConfirmed: true,
  };
}

export function detectNewlyConfirmedFractalPivot(
  bars: readonly FvgBar[],
  pivotType: PivotType
): Pivot | null {
  const pivotIndex = bars.length - 1 - FVG_PIVOT_LEN;
  if (pivotIndex < 0) return null;

  return detectConfirmedFractalPivotAtIndex(bars, pivotType, pivotIndex);
}
