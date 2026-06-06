import { TRENDLINE_MODEL_TFS, TRENDLINE_PIVOT_LEN } from "./constants";
import type { Pivot, TrendlineBar, TrendlineModelTf } from "./types";

function assertSameTfAscending(bars: readonly TrendlineBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Trendline pivot bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Trendline pivot bars must be strictly ascending by closeTime");
    }
  }
}

export function isTrendlinePivotTf(tf: string): tf is TrendlineModelTf {
  return (TRENDLINE_MODEL_TFS as readonly string[]).includes(tf);
}

export function detectConfirmedTrendlinePivotAtIndex(
  tfBars: readonly TrendlineBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) return null;
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const center = tfBars[pivotIndex];
  if (!center) return null;
  if (!isTrendlinePivotTf(center.tf)) return null;

  const leftStart = pivotIndex - TRENDLINE_PIVOT_LEN;
  const rightEnd = pivotIndex + TRENDLINE_PIVOT_LEN;

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

export function detectNewlyConfirmedTrendlinePivot(
  tfBars: readonly TrendlineBar[],
  pivotType: "HIGH" | "LOW"
): Pivot | null {
  if (tfBars.length === 0) return null;

  const pivotIndex = tfBars.length - 1 - TRENDLINE_PIVOT_LEN;
  if (pivotIndex < 0) {
    return null;
  }

  return detectConfirmedTrendlinePivotAtIndex(tfBars, pivotType, pivotIndex);
}

export function appendTrendlinePivotKeepingLast3(
  pivots: readonly Pivot[],
  pivot: Pivot
): Pivot[] {
  const exists = pivots.some(
    (p) =>
      p.tf === pivot.tf &&
      p.pivotType === pivot.pivotType &&
      p.pivotTime === pivot.pivotTime &&
      p.confirmedAt === pivot.confirmedAt
  );

  if (exists) {
    return [...pivots];
  }

  return [...pivots, pivot]
    .sort((a, b) => {
      if (a.confirmedAt !== b.confirmedAt) {
        return a.confirmedAt - b.confirmedAt;
      }

      if (a.pivotTime !== b.pivotTime) {
        return a.pivotTime - b.pivotTime;
      }

      return a.pivotPrice - b.pivotPrice;
    })
    .slice(-3);
}
