import { evaluateStructureAtClose } from "../fvg/structure";
import { createD1H4OperationalChannel, type D1H4ChannelTf } from "./basic";
import {
  createH1M30OperationalChannel,
  type H1M30ChannelTf,
} from "./h1m30";
import { evaluateChannelOffsetFromResiduals } from "./offset";
import type {
  AnchorPoint,
  ChannelBar,
  ChannelDir,
  ChannelModel,
  ChannelModelTf,
  Pivot,
  StructureState,
} from "./types";

const PIVOT_LEN = 3;
const MIN_SWING_MULT = 0.25;

export interface ChannelContextState {
  bars: ChannelBar[];
  highs: Pivot[];
  lows: Pivot[];
  structureState: StructureState;
}

export interface ChannelAnchorPair {
  a: AnchorPoint;
  b: AnchorPoint;
}

export interface ChannelAnchorResolution {
  resolvedDirection: ChannelDir | null;
  upPair: ChannelAnchorPair | null;
  downPair: ChannelAnchorPair | null;
}

export function createEmptyChannelContextState(): ChannelContextState {
  return {
    bars: [],
    highs: [],
    lows: [],
    structureState: "MIXED",
  };
}

function assertSameTfAscending(bars: readonly ChannelBar[]) {
  if (bars.length === 0) {
    return;
  }

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Channel bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Channel bars must be strictly ascending by closeTime");
    }
  }
}

function appendBarKeepingRecent(
  bars: readonly ChannelBar[],
  nextBar: ChannelBar,
  maxSize: number
): ChannelBar[] {
  if (bars.length > 0) {
    const last = bars[bars.length - 1];
    if (nextBar.closeTime <= last.closeTime) {
      return [...bars];
    }
  }

  const next = [...bars, nextBar];
  return next.length > maxSize ? next.slice(next.length - maxSize) : next;
}

function detectConfirmedChannelPivotAtIndex(
  bars: readonly ChannelBar[],
  pivotType: "HIGH" | "LOW",
  pivotIndex: number
): Pivot | null {
  if (!Number.isInteger(pivotIndex)) {
    return null;
  }

  if (bars.length === 0) {
    return null;
  }

  assertSameTfAscending(bars);

  const center = bars[pivotIndex];
  if (!center) {
    return null;
  }

  const leftStart = pivotIndex - PIVOT_LEN;
  const rightEnd = pivotIndex + PIVOT_LEN;
  if (leftStart < 0 || rightEnd >= bars.length) {
    return null;
  }

  if (pivotType === "HIGH") {
    for (let i = leftStart; i <= rightEnd; i += 1) {
      if (i === pivotIndex) {
        continue;
      }

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
    if (i === pivotIndex) {
      continue;
    }

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

function detectNewlyConfirmedChannelPivot(
  bars: readonly ChannelBar[],
  pivotType: "HIGH" | "LOW"
): Pivot | null {
  const pivotIndex = bars.length - 1 - PIVOT_LEN;
  if (pivotIndex < 0) {
    return null;
  }

  return detectConfirmedChannelPivotAtIndex(bars, pivotType, pivotIndex);
}

function getLatestPivot(
  pivots: readonly Pivot[],
  pivotType: "HIGH" | "LOW"
): Pivot | undefined {
  for (let i = pivots.length - 1; i >= 0; i -= 1) {
    if (pivots[i].pivotType === pivotType) {
      return pivots[i];
    }
  }

  return undefined;
}

export function updateChannelContextState(
  prev: ChannelContextState,
  bar: ChannelBar,
  maxSize: number
): {
  next: ChannelContextState;
  structureEval: ReturnType<typeof evaluateStructureAtClose>;
} {
  const bars = appendBarKeepingRecent(prev.bars, bar, maxSize);
  const highs = [...prev.highs];
  const lows = [...prev.lows];

  const newHigh = detectNewlyConfirmedChannelPivot(bars, "HIGH");
  if (newHigh) {
    highs.push(newHigh);
  }

  const newLow = detectNewlyConfirmedChannelPivot(bars, "LOW");
  if (newLow) {
    lows.push(newLow);
  }

  const structureEval = evaluateStructureAtClose({
    prevState: prev.structureState,
    close: bar.close,
    lastConfirmedPivotHigh: getLatestPivot(highs, "HIGH"),
    lastConfirmedPivotLow: getLatestPivot(lows, "LOW"),
  });

  return {
    next: {
      bars,
      highs,
      lows,
      structureState: structureEval.nextState,
    },
    structureEval,
  };
}

export function selectCanonicalUpAnchorPair(
  pivotLows: readonly Pivot[],
  minSwing: number
): ChannelAnchorPair | null {
  for (let bIndex = pivotLows.length - 1; bIndex >= 0; bIndex -= 1) {
    const b = pivotLows[bIndex];

    for (let aIndex = bIndex - 1; aIndex >= 0; aIndex -= 1) {
      const a = pivotLows[aIndex];

      if (!(a.pivotTime < b.pivotTime)) {
        continue;
      }

      if (!(b.pivotPrice > a.pivotPrice)) {
        continue;
      }

      if (b.pivotPrice - a.pivotPrice < minSwing) {
        continue;
      }

      return {
        a: { time: a.pivotTime, price: a.pivotPrice },
        b: { time: b.pivotTime, price: b.pivotPrice },
      };
    }
  }

  return null;
}

export function selectCanonicalDownAnchorPair(
  pivotHighs: readonly Pivot[],
  minSwing: number
): ChannelAnchorPair | null {
  for (let bIndex = pivotHighs.length - 1; bIndex >= 0; bIndex -= 1) {
    const b = pivotHighs[bIndex];

    for (let aIndex = bIndex - 1; aIndex >= 0; aIndex -= 1) {
      const a = pivotHighs[aIndex];

      if (!(a.pivotTime < b.pivotTime)) {
        continue;
      }

      if (!(b.pivotPrice < a.pivotPrice)) {
        continue;
      }

      if (a.pivotPrice - b.pivotPrice < minSwing) {
        continue;
      }

      return {
        a: { time: a.pivotTime, price: a.pivotPrice },
        b: { time: b.pivotTime, price: b.pivotPrice },
      };
    }
  }

  return null;
}

export function resolveChannelDirectionFromPairs(args: {
  upPair: ChannelAnchorPair | null;
  downPair: ChannelAnchorPair | null;
  structureState: StructureState;
}): ChannelDir | null {
  const { upPair, downPair, structureState } = args;

  if (upPair && !downPair) {
    return "UP";
  }

  if (downPair && !upPair) {
    return "DOWN";
  }

  if (upPair && downPair) {
    if (structureState === "UP") {
      return "UP";
    }

    if (structureState === "DOWN") {
      return "DOWN";
    }

    return null;
  }

  return null;
}

export function resolveCanonicalChannelAnchors(args: {
  pivotHighs: readonly Pivot[];
  pivotLows: readonly Pivot[];
  atrAtNow: number;
  structureState: StructureState;
}): ChannelAnchorResolution {
  const minSwing = args.atrAtNow * MIN_SWING_MULT;
  const upPair = selectCanonicalUpAnchorPair(args.pivotLows, minSwing);
  const downPair = selectCanonicalDownAnchorPair(args.pivotHighs, minSwing);

  return {
    resolvedDirection: resolveChannelDirectionFromPairs({
      upPair,
      downPair,
      structureState: args.structureState,
    }),
    upPair,
    downPair,
  };
}

export function buildChannelModelFromResolvedAnchors(args: {
  symbol: string;
  tf: ChannelModelTf;
  bars: readonly ChannelBar[];
  structureState: StructureState;
  pivotHighs: readonly Pivot[];
  pivotLows: readonly Pivot[];
  createdAt: number;
  activeParentPoiCount?: number;
}): ChannelModel | null {
  const {
    symbol,
    tf,
    bars,
    structureState,
    pivotHighs,
    pivotLows,
    createdAt,
    activeParentPoiCount = 0,
  } = args;

  const atrNow = (() => {
    if (bars.length < 15) {
      return null;
    }

    let sum = 0;
    let atr: number | null = null;

    for (let i = 0; i < bars.length; i += 1) {
      const prevClose = i > 0 ? bars[i - 1].close : undefined;
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Number.isFinite(prevClose)
          ? Math.abs(bars[i].high - (prevClose as number))
          : Number.NEGATIVE_INFINITY,
        Number.isFinite(prevClose)
          ? Math.abs(bars[i].low - (prevClose as number))
          : Number.NEGATIVE_INFINITY
      );

      if (i < 14) {
        sum += tr;
        if (i === 13) {
          atr = sum / 14;
        }
      } else {
        atr = (((atr as number) * 13) + tr) / 14;
      }
    }

    return atr;
  })();

  if (!(Number.isFinite(atrNow) && (atrNow as number) > 0)) {
    return null;
  }

  const resolved = resolveCanonicalChannelAnchors({
    pivotHighs,
    pivotLows,
    atrAtNow: atrNow as number,
    structureState,
  });

  if (!resolved.resolvedDirection) {
    return null;
  }

  const anchorPair =
    resolved.resolvedDirection === "UP" ? resolved.upPair : resolved.downPair;
  if (!anchorPair) {
    return null;
  }

  const offsetEval = evaluateChannelOffsetFromResiduals({
    tf,
    tfBars: bars,
    dir: resolved.resolvedDirection,
    anchorLine: {
      a: anchorPair.a,
      b: anchorPair.b,
      slope:
        (anchorPair.b.price - anchorPair.a.price) /
        (anchorPair.b.time - anchorPair.a.time),
      intercept:
        anchorPair.a.price -
        ((anchorPair.b.price - anchorPair.a.price) /
          (anchorPair.b.time - anchorPair.a.time)) *
          anchorPair.a.time,
    },
  });

  if (!offsetEval?.enoughSamples || !Number.isFinite(offsetEval.offset)) {
    return null;
  }

  if (tf === "D1" || tf === "H4") {
    return createD1H4OperationalChannel({
      symbol,
      tf: tf as D1H4ChannelTf,
      dir: resolved.resolvedDirection,
      a: anchorPair.a,
      b: anchorPair.b,
      offset: offsetEval.offset as number,
      createdAt,
    });
  }

  return createH1M30OperationalChannel({
    symbol,
    tf: tf as H1M30ChannelTf,
    dir: resolved.resolvedDirection,
    a: anchorPair.a,
    b: anchorPair.b,
    offset: offsetEval.offset as number,
    createdAt,
    activeParentPoiCount,
  });
}
