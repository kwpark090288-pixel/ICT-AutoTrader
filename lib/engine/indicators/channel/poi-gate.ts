import {
  POI_GATE_D1,
  POI_GATE_H1,
  POI_GATE_H4,
  POI_GATE_M30,
} from "./constants";
import { linePriceAt } from "./basic";
import type {
  ChannelBar,
  ChannelModel,
  ChannelModelTf,
  ChannelPoiGateEvalResult,
  Dir,
} from "./types";

const ATR_PERIOD = 14;

export type ChannelPoiTf = "D1" | "H4" | "H1" | "M30";

function assertSameTfAscending(bars: readonly ChannelBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Channel POI gate bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Channel POI gate bars must be strictly ascending by closeTime");
    }
  }
}

function computeTrueRange(bar: ChannelBar, prevClose?: number): number {
  const highLow = bar.high - bar.low;

  if (!Number.isFinite(prevClose)) {
    return highLow;
  }

  return Math.max(
    highLow,
    Math.abs(bar.high - (prevClose as number)),
    Math.abs(bar.low - (prevClose as number))
  );
}

function getAtrValueAtCloseTime(
  tfBars: readonly ChannelBar[],
  closeTime: number
): number | null {
  if (tfBars.length < ATR_PERIOD) {
    return null;
  }

  assertSameTfAscending(tfBars);

  const trValues: number[] = [];
  let atr: number | null = null;

  for (let i = 0; i < tfBars.length; i += 1) {
    const prevClose = i > 0 ? tfBars[i - 1].close : undefined;
    const tr = computeTrueRange(tfBars[i], prevClose);

    if (i < ATR_PERIOD - 1) {
      trValues.push(tr);
      continue;
    }

    if (i === ATR_PERIOD - 1) {
      trValues.push(tr);
      atr = trValues.reduce((sum, v) => sum + v, 0) / ATR_PERIOD;
    } else {
      atr = (((atr as number) * (ATR_PERIOD - 1)) + tr) / ATR_PERIOD;
    }

    if (tfBars[i].closeTime === closeTime) {
      return atr;
    }
  }

  return null;
}

export function isChannelPoiTf(tf: string): tf is ChannelPoiTf {
  return tf === "D1" || tf === "H4" || tf === "H1" || tf === "M30";
}

export function getChannelPoiGateAtrMultiplier(
  tf: ChannelPoiTf
): number {
  if (tf === "D1") return POI_GATE_D1;
  if (tf === "H4") return POI_GATE_H4;
  if (tf === "H1") return POI_GATE_H1;
  return POI_GATE_M30;
}

function getChannelPoiDir(channel: ChannelModel): Dir | null {
  if (!channel.geometry) return null;
  return channel.geometry.dir === "UP" ? "BULL" : "BEAR";
}

export function getChannelPoiBoundaryPriceAt(
  channel: ChannelModel,
  time: number
): number | null {
  if (!channel.geometry) {
    return null;
  }

  return linePriceAt(channel.geometry.anchorLine, time);
}

export function getChannelPoiWickExtreme(
  bar: ChannelBar,
  channelDir: "UP" | "DOWN"
): number {
  return channelDir === "UP" ? bar.low : bar.high;
}

export function computeChannelPoiGateDist(
  wickExtreme: number,
  boundaryPrice: number
): number {
  return Math.abs(wickExtreme - boundaryPrice);
}

type EvaluateChannelPoiGateOnBarArgs = {
  channel: ChannelModel;
  bar: ChannelBar;
  atrAtBar: number;
};

export function evaluateChannelPoiGateOnBar(
  args: EvaluateChannelPoiGateOnBarArgs
): ChannelPoiGateEvalResult | null {
  const { channel, bar, atrAtBar } = args;

  if (!isChannelPoiTf(channel.tf)) return null;
  if (!isChannelPoiTf(bar.tf)) return null;
  if (channel.tf !== bar.tf) return null;
  if (!channel.geometry) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;

  const boundaryPrice = getChannelPoiBoundaryPriceAt(channel, bar.closeTime);
  const dir = getChannelPoiDir(channel);

  if (boundaryPrice === null || dir === null) {
    return null;
  }

  const wickExtreme = getChannelPoiWickExtreme(bar, channel.geometry.dir);
  const dist = computeChannelPoiGateDist(wickExtreme, boundaryPrice);
  const gateAtrMultiplier = getChannelPoiGateAtrMultiplier(channel.tf);

  return {
    tf: channel.tf,
    dir,
    currentCloseTime: bar.closeTime,
    boundaryPrice,
    wickExtreme,
    dist,
    atrAtBar,
    gateAtrMultiplier,
    passGate: dist <= atrAtBar * gateAtrMultiplier,
  };
}

export function evaluateChannelPoiGateFromTfBars(
  tfBars: readonly ChannelBar[],
  channel: ChannelModel
): ChannelPoiGateEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtBar = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtBar)) {
    return null;
  }

  return evaluateChannelPoiGateOnBar({
    channel,
    bar: currentBar,
    atrAtBar: atrAtBar as number,
  });
}
