import { TRENDLINE_MODEL_TFS } from "./constants";
import type {
  Pivot,
  StructureSnapshot,
  StructureState,
  TrendlineModelTf,
} from "./types";

export function isTrendlineStructureTf(
  tf: string
): tf is TrendlineModelTf {
  return (TRENDLINE_MODEL_TFS as readonly string[]).includes(tf);
}

export function takeLatestConfirmedTrendlinePivots(
  pivots: readonly Pivot[],
  pivotType: "HIGH" | "LOW"
): Pivot[] {
  return [...pivots]
    .filter(
      (pivot) =>
        pivot.isConfirmed &&
        pivot.pivotType === pivotType &&
        isTrendlineStructureTf(pivot.tf)
    )
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

export function evaluateTrendlineStructureState(
  lastHighs: readonly Pivot[],
  lastLows: readonly Pivot[]
): StructureState {
  if (lastHighs.length < 3 || lastLows.length < 3) {
    return "MIXED";
  }

  const [h1, h2, h3] = lastHighs;
  const [l1, l2, l3] = lastLows;

  const highsUp = h2.pivotPrice > h1.pivotPrice && h3.pivotPrice > h2.pivotPrice;
  const lowsUp = l2.pivotPrice > l1.pivotPrice && l3.pivotPrice > l2.pivotPrice;

  if ([highsUp, lowsUp].filter(Boolean).length >= 2) {
    return "UP";
  }

  const highsDown =
    h2.pivotPrice < h1.pivotPrice && h3.pivotPrice < h2.pivotPrice;
  const lowsDown =
    l2.pivotPrice < l1.pivotPrice && l3.pivotPrice < l2.pivotPrice;

  if ([highsDown, lowsDown].filter(Boolean).length >= 2) {
    return "DOWN";
  }

  return "MIXED";
}

type BuildTrendlineStructureSnapshotArgs = {
  tf: string;
  time: number;
  highs: readonly Pivot[];
  lows: readonly Pivot[];
};

export function buildTrendlineStructureSnapshot(
  args: BuildTrendlineStructureSnapshotArgs
): StructureSnapshot | null {
  const { tf, time, highs, lows } = args;

  if (!isTrendlineStructureTf(tf)) {
    return null;
  }

  const lastHighs = takeLatestConfirmedTrendlinePivots(highs, "HIGH");
  const lastLows = takeLatestConfirmedTrendlinePivots(lows, "LOW");

  return {
    tf,
    time,
    state: evaluateTrendlineStructureState(lastHighs, lastLows),
    lastHighs,
    lastLows,
  };
}
