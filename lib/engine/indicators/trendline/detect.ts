import {
  getAtrValueAtCloseTime,
} from "../../atr";
import type { Bar } from "../../types";
import {
  LOOKBACK_D1,
  LOOKBACK_H1,
  LOOKBACK_H4,
  LOOKBACK_M30,
  MAX_FORWARD_BARS_D1,
  MAX_FORWARD_BARS_H1,
  MAX_FORWARD_BARS_H4,
  MAX_FORWARD_BARS_M30,
  MIN_SWING_ATR_D1,
  MIN_SWING_ATR_H1,
  MIN_SWING_ATR_H4,
  MIN_SWING_ATR_M30,
  MIXED_RISK_TAG,
  MIXED_SWING_MULT,
  TRENDLINE_MODEL_TFS,
} from "./constants";
import type {
  Pivot,
  StructureState,
  Trendline,
  TrendlineModelTf,
  TrendlineType,
} from "./types";

const D1_BAR_DURATION_MS = 24 * 60 * 60 * 1000;
const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;
const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

type SelectAnchorsWithinLookbackArgs = {
  tf: TrendlineModelTf;
  currentCloseTime: number;
  pivots: readonly Pivot[];
  bars?: readonly Bar[];
  pivotType: "HIGH" | "LOW";
  atrAtAnchor2?: number;
  structureState: StructureState;
};

type CreateTrendlineFromAnchorsArgs = {
  symbol: string;
  tf: TrendlineModelTf;
  type: TrendlineType;
  a1: Pivot;
  a2: Pivot;
  structureState: StructureState;
};

type DetectTrendlineCandidatesArgs = {
  symbol: string;
  tf: string;
  currentCloseTime: number;
  structureState: StructureState;
  highs: readonly Pivot[];
  lows: readonly Pivot[];
  bars?: readonly Bar[];
  atrAtHighAnchor2: number;
  atrAtLowAnchor2: number;
};

export function isTrendlineDetectTf(tf: string): tf is TrendlineModelTf {
  return (TRENDLINE_MODEL_TFS as readonly string[]).includes(tf);
}

export function getTrendlineLookbackBars(tf: TrendlineModelTf): number {
  if (tf === "D1") return LOOKBACK_D1;
  if (tf === "H4") return LOOKBACK_H4;
  if (tf === "H1") return LOOKBACK_H1;
  return LOOKBACK_M30;
}

export function getTrendlineMinSwingAtrMultiplier(
  tf: TrendlineModelTf
): number {
  if (tf === "D1") return MIN_SWING_ATR_D1;
  if (tf === "H4") return MIN_SWING_ATR_H4;
  if (tf === "H1") return MIN_SWING_ATR_H1;
  return MIN_SWING_ATR_M30;
}

export function getTrendlineMaxForwardBars(tf: TrendlineModelTf): number {
  if (tf === "D1") return MAX_FORWARD_BARS_D1;
  if (tf === "H4") return MAX_FORWARD_BARS_H4;
  if (tf === "H1") return MAX_FORWARD_BARS_H1;
  return MAX_FORWARD_BARS_M30;
}

function getTrendlineTfDurationMs(tf: TrendlineModelTf): number {
  if (tf === "D1") return D1_BAR_DURATION_MS;
  if (tf === "H4") return H4_BAR_DURATION_MS;
  if (tf === "H1") return H1_BAR_DURATION_MS;
  return M30_BAR_DURATION_MS;
}

export function getTrendlineDisplayUntil(
  tf: TrendlineModelTf,
  createdAt: number
): number {
  return (
    createdAt + getTrendlineMaxForwardBars(tf) * getTrendlineTfDurationMs(tf)
  );
}

export function checkTrendlineMinSwing(args: {
  tf: TrendlineModelTf;
  a1: Pivot;
  a2: Pivot;
  atrAtA2: number;
  structureState: StructureState;
}): boolean {
  const { tf, a1, a2, atrAtA2, structureState } = args;

  if (!Number.isFinite(atrAtA2) || atrAtA2 <= 0) {
    return false;
  }

  const swing = Math.abs(a2.pivotPrice - a1.pivotPrice);

  let minSwing = atrAtA2 * getTrendlineMinSwingAtrMultiplier(tf);

  if (structureState === "MIXED") {
    minSwing *= MIXED_SWING_MULT;
  }

  return swing >= minSwing;
}

export function selectAnchorsWithinLookback(
  args: SelectAnchorsWithinLookbackArgs
): readonly [Pivot, Pivot] | null {
  const {
    tf,
    currentCloseTime,
    pivots,
    bars,
    pivotType,
    atrAtAnchor2,
    structureState,
  } = args;

  const lookbackMs =
    getTrendlineLookbackBars(tf) * getTrendlineTfDurationMs(tf);

  const eligible = [...pivots]
    .filter(
      (pivot) =>
        pivot.isConfirmed &&
        pivot.tf === tf &&
        pivot.pivotType === pivotType &&
        pivot.confirmedAt <= currentCloseTime &&
        pivot.confirmedAt >= currentCloseTime - lookbackMs
    )
    .sort((a, b) => {
      if (a.confirmedAt !== b.confirmedAt) {
        return a.confirmedAt - b.confirmedAt;
      }

      if (a.pivotTime !== b.pivotTime) {
        return a.pivotTime - b.pivotTime;
      }

      return a.pivotPrice - b.pivotPrice;
    });

  if (eligible.length < 2) {
    return null;
  }

  for (let a2Index = eligible.length - 1; a2Index >= 1; a2Index -= 1) {
    const a2 = eligible[a2Index];
    const atrAtCurrentA2 = bars?.length
      ? (getAtrValueAtCloseTime(bars, a2.confirmedAt) ?? Number.NaN)
      : (atrAtAnchor2 ?? Number.NaN);

    for (let i = a2Index - 1; i >= 0; i -= 1) {
      const a1 = eligible[i];

      if (
        checkTrendlineMinSwing({
          tf,
          a1,
          a2,
          atrAtA2: atrAtCurrentA2,
          structureState,
        })
      ) {
        return [a1, a2];
      }
    }
  }

  return null;
}

export function createTrendlineFromAnchors(
  args: CreateTrendlineFromAnchorsArgs
): Trendline {
  const { symbol, tf, type, a1, a2, structureState } = args;

  const createdAt = a2.confirmedAt;
  const tags = structureState === "MIXED" ? [MIXED_RISK_TAG] : [];

  return {
    id: `${symbol.toUpperCase()}:TL:${tf}:${type}:${a1.pivotTime}:${a1.pivotPrice}:${a2.pivotTime}:${a2.pivotPrice}`,
    symbol: symbol.toUpperCase(),
    tf,
    type,
    state: "ACTIVE",
    a1Time: a1.pivotTime,
    a1Price: a1.pivotPrice,
    a2Time: a2.pivotTime,
    a2Price: a2.pivotPrice,
    createdAt,
    lastUpdatedAt: createdAt,
    touchCount: 0,
    breakStreak: 0,
    roleFlipCount: 0,
    tags,
    bestMatch: {
      kind: "NONE",
    },
    maxForwardBars: getTrendlineMaxForwardBars(tf),
    displayUntil: getTrendlineDisplayUntil(tf, createdAt),
  };
}

export function detectTrendlineCandidates(
  args: DetectTrendlineCandidatesArgs
): Trendline[] {
  const {
    symbol,
    tf,
    currentCloseTime,
    structureState,
    highs,
    lows,
    atrAtHighAnchor2,
    atrAtLowAnchor2,
  } = args;

  if (!isTrendlineDetectTf(tf)) {
    return [];
  }

  const out: Trendline[] = [];

  const allowSupport =
    tf === "H1" || tf === "M30" ? true : structureState !== "DOWN";

  const allowResist =
    tf === "H1" || tf === "M30" ? true : structureState !== "UP";

  if (allowSupport) {
    const anchors = selectAnchorsWithinLookback({
      tf,
      currentCloseTime,
      pivots: lows,
      bars: args.bars,
      pivotType: "LOW",
      atrAtAnchor2: atrAtLowAnchor2,
      structureState,
    });

    if (anchors) {
      out.push(
        createTrendlineFromAnchors({
          symbol,
          tf,
          type: "TL_SUPPORT",
          a1: anchors[0],
          a2: anchors[1],
          structureState,
        })
      );
    }
  }

  if (allowResist) {
    const anchors = selectAnchorsWithinLookback({
      tf,
      currentCloseTime,
      pivots: highs,
      bars: args.bars,
      pivotType: "HIGH",
      atrAtAnchor2: atrAtHighAnchor2,
      structureState,
    });

    if (anchors) {
      out.push(
        createTrendlineFromAnchors({
          symbol,
          tf,
          type: "TL_RESIST",
          a1: anchors[0],
          a2: anchors[1],
          structureState,
        })
      );
    }
  }

  return out;
}
