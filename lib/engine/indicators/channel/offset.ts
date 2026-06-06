import {
  LOOKBACK_BARS,
  MIN_RESIDUAL_SAMPLES,
  OFFSET_PCTL_D1,
  OFFSET_PCTL_H1,
  OFFSET_PCTL_H4,
  OFFSET_PCTL_M30,
} from "./constants";
import { linePriceAt } from "./basic";
import type {
  ChannelBar,
  ChannelDir,
  ChannelModelTf,
  ChannelResidualOffsetEvalResult,
  Line2P,
} from "./types";

export type ChannelResidualTf = "D1" | "H4" | "H1" | "M30";

type CollectPositiveResidualSamplesArgs = {
  tfBars: readonly ChannelBar[];
  dir: ChannelDir;
  anchorLine: Line2P;
  endIndex?: number;
};

type EvaluateChannelOffsetFromResidualsArgs = {
  tf: string;
  tfBars: readonly ChannelBar[];
  dir: ChannelDir;
  anchorLine: Line2P;
  endIndex?: number;
};

function assertSameTfAscending(bars: readonly ChannelBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Channel residual bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Channel residual bars must be strictly ascending by closeTime");
    }
  }
}

export function isChannelResidualTf(tf: string): tf is ChannelResidualTf {
  return tf === "D1" || tf === "H4" || tf === "H1" || tf === "M30";
}

export function getChannelOffsetPercentile(
  tf: ChannelResidualTf
): 95 | 90 | 85 | 80 {
  if (tf === "D1") return OFFSET_PCTL_D1;
  if (tf === "H4") return OFFSET_PCTL_H4;
  if (tf === "H1") return OFFSET_PCTL_H1;
  return OFFSET_PCTL_M30;
}

export function computeChannelResidualRaw(
  dir: ChannelDir,
  bar: ChannelBar,
  anchorLine: Line2P
): number {
  const anchorPrice = linePriceAt(anchorLine, bar.closeTime);

  return dir === "UP"
    ? bar.low - anchorPrice
    : anchorPrice - bar.high;
}

export function collectPositiveResidualSamples(
  args: CollectPositiveResidualSamplesArgs
): number[] {
  const { tfBars, dir, anchorLine } = args;

  if (tfBars.length === 0) {
    return [];
  }

  assertSameTfAscending(tfBars);

  const endIndex = args.endIndex ?? tfBars.length - 1;
  if (endIndex < 0 || endIndex >= tfBars.length) {
    return [];
  }

  const startIndex = Math.max(0, endIndex - LOOKBACK_BARS + 1);
  const out: number[] = [];

  for (let i = startIndex; i <= endIndex; i += 1) {
    const residual = computeChannelResidualRaw(dir, tfBars[i], anchorLine);

    if (residual > 0) {
      out.push(residual);
    }
  }

  return out;
}

export function percentileNearestRank(
  values: readonly number[],
  percentile: number
): number | null {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);

  return sorted[Math.max(0, rank - 1)];
}

export function evaluateChannelOffsetFromResiduals(
  args: EvaluateChannelOffsetFromResidualsArgs
): ChannelResidualOffsetEvalResult | null {
  const { tf, tfBars, dir, anchorLine } = args;

  if (!isChannelResidualTf(tf)) {
    return null;
  }

  const percentile = getChannelOffsetPercentile(tf);
  const residuals = collectPositiveResidualSamples({
    tfBars,
    dir,
    anchorLine,
    endIndex: args.endIndex,
  });

  const enoughSamples = residuals.length >= MIN_RESIDUAL_SAMPLES;

  return {
    tf,
    percentile,
    positiveResidualCount: residuals.length,
    offset: enoughSamples ? percentileNearestRank(residuals, percentile) : null,
    enoughSamples,
  };
}
