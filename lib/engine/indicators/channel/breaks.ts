import {
  BREAK_D1_ATR,
  BREAK_D1_CLOSES,
  BREAK_H1_ATR,
  BREAK_H1_CLOSES,
  BREAK_H4_ATR,
  BREAK_H4_CLOSES,
  BREAK_M30_ATR,
  BREAK_M30_CLOSES,
} from "./constants";
import { linePriceAt } from "./basic";
import type {
  ChannelBar,
  ChannelBoundaryInvalidEvalResult,
  ChannelModel,
  ChannelModelTf,
} from "./types";

export type ChannelBreakTf = "D1" | "H4" | "H1" | "M30";

type ChannelBreakRule = {
  requiredConsecutiveCloses: number;
  atrMultiplier: number;
};

type EvaluateChannelBoundaryArgs = {
  channel: ChannelModel;
  tfBars: readonly ChannelBar[];
  currentIndex: number;
  atrAtBar: number;
};

function assertSameTfAscending(bars: readonly ChannelBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Channel break bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Channel break bars must be strictly ascending by closeTime");
    }
  }
}

export function isChannelBreakTf(tf: string): tf is ChannelBreakTf {
  return tf === "D1" || tf === "H4" || tf === "H1" || tf === "M30";
}

export function getChannelBreakRule(tf: ChannelBreakTf): ChannelBreakRule {
  if (tf === "D1") {
    return {
      requiredConsecutiveCloses: BREAK_D1_CLOSES,
      atrMultiplier: BREAK_D1_ATR,
    };
  }

  if (tf === "H4") {
    return {
      requiredConsecutiveCloses: BREAK_H4_CLOSES,
      atrMultiplier: BREAK_H4_ATR,
    };
  }

  if (tf === "H1") {
    return {
      requiredConsecutiveCloses: BREAK_H1_CLOSES,
      atrMultiplier: BREAK_H1_ATR,
    };
  }

  return {
    requiredConsecutiveCloses: BREAK_M30_CLOSES,
    atrMultiplier: BREAK_M30_ATR,
  };
}

export function getChannelAnchorPriceAt(
  channel: ChannelModel,
  time: number
): number | null {
  if (!channel.geometry) {
    return null;
  }

  return linePriceAt(channel.geometry.anchorLine, time);
}

export function getChannelBreakBoundaryPriceAt(
  channel: ChannelModel,
  time: number
): number | null {
  const anchorPrice = getChannelAnchorPriceAt(channel, time);

  if (anchorPrice === null || !channel.geometry) {
    return null;
  }

  return channel.geometry.dir === "UP"
    ? anchorPrice + channel.geometry.offset
    : anchorPrice - channel.geometry.offset;
}

function isBreakOutsideClose(
  channel: ChannelModel,
  close: number,
  boundaryPrice: number
): boolean {
  if (!channel.geometry) return false;

  return channel.geometry.dir === "UP"
    ? close > boundaryPrice
    : close < boundaryPrice;
}

function isAnchorInvalidClose(
  channel: ChannelModel,
  close: number,
  anchorPrice: number
): boolean {
  if (!channel.geometry) return false;

  return channel.geometry.dir === "UP"
    ? close < anchorPrice
    : close > anchorPrice;
}

function getBreakDeviation(
  channel: ChannelModel,
  close: number,
  boundaryPrice: number
): number {
  if (!channel.geometry) return 0;

  return channel.geometry.dir === "UP"
    ? Math.max(0, close - boundaryPrice)
    : Math.max(0, boundaryPrice - close);
}

function getAnchorDeviation(
  channel: ChannelModel,
  close: number,
  anchorPrice: number
): number {
  if (!channel.geometry) return 0;

  return channel.geometry.dir === "UP"
    ? Math.max(0, anchorPrice - close)
    : Math.max(0, close - anchorPrice);
}

export function evaluateChannelBreakAtBar(
  args: EvaluateChannelBoundaryArgs
): ChannelBoundaryInvalidEvalResult | null {
  const { channel, tfBars, currentIndex, atrAtBar } = args;

  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;
  if (!isChannelBreakTf(channel.tf)) return null;
  if (!channel.geometry) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[currentIndex];
  const rule = getChannelBreakRule(channel.tf);

  const currentBoundary = getChannelBreakBoundaryPriceAt(
    channel,
    currentBar.closeTime
  );
  if (currentBoundary === null) return null;

  let closeCount = 0;

  for (let i = currentIndex; i >= 0; i -= 1) {
    const boundary = getChannelBreakBoundaryPriceAt(channel, tfBars[i].closeTime);
    if (boundary === null) break;

    if (!isBreakOutsideClose(channel, tfBars[i].close, boundary)) {
      break;
    }

    closeCount += 1;
  }

  const closeDeviation = getBreakDeviation(
    channel,
    currentBar.close,
    currentBoundary
  );

  return {
    tf: channel.tf,
    currentCloseTime: currentBar.closeTime,
    requiredConsecutiveCloses: rule.requiredConsecutiveCloses,
    atrAtBar,
    atrMultiplier: rule.atrMultiplier,
    closeCount,
    boundaryPrice: currentBoundary,
    closeDeviation,
    pass:
      closeCount >= rule.requiredConsecutiveCloses &&
      closeDeviation >= atrAtBar * rule.atrMultiplier,
  };
}

export function evaluateChannelAnchorInvalidAtBar(
  args: EvaluateChannelBoundaryArgs
): ChannelBoundaryInvalidEvalResult | null {
  const { channel, tfBars, currentIndex, atrAtBar } = args;

  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;
  if (!isChannelBreakTf(channel.tf)) return null;
  if (!channel.geometry) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[currentIndex];
  const rule = getChannelBreakRule(channel.tf);

  const currentAnchor = getChannelAnchorPriceAt(channel, currentBar.closeTime);
  if (currentAnchor === null) return null;

  let closeCount = 0;

  for (let i = currentIndex; i >= 0; i -= 1) {
    const anchorPrice = getChannelAnchorPriceAt(channel, tfBars[i].closeTime);
    if (anchorPrice === null) break;

    if (!isAnchorInvalidClose(channel, tfBars[i].close, anchorPrice)) {
      break;
    }

    closeCount += 1;
  }

  const closeDeviation = getAnchorDeviation(
    channel,
    currentBar.close,
    currentAnchor
  );

  return {
    tf: channel.tf,
    currentCloseTime: currentBar.closeTime,
    requiredConsecutiveCloses: rule.requiredConsecutiveCloses,
    atrAtBar,
    atrMultiplier: rule.atrMultiplier,
    closeCount,
    boundaryPrice: currentAnchor,
    closeDeviation,
    pass:
      closeCount >= rule.requiredConsecutiveCloses &&
      closeDeviation >= atrAtBar * rule.atrMultiplier,
  };
}
