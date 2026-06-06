import {
  DISP_BODY_MAX_ATR,
  DISP_BODY_SUM_ATR,
} from "./constants";
import { getChannelPoiBoundaryPriceAt } from "./poi-gate";
import type {
  ChannelBar,
  ChannelDispTriggerEvalResult,
  ChannelModel,
  ChannelPoiTriggerEvalResult,
  PoiTrigger,
} from "./types";

type ChannelStructureBreakType = "BOS" | "CHOCH";

type EvaluateChannelDispTriggerAtBarArgs = {
  tfBars: readonly ChannelBar[];
  currentIndex: number;
  atrAtBar: number;
};

type EvaluateChannelSweepRecTriggerNowArgs = {
  channel: ChannelModel;
  tfBars: readonly ChannelBar[];
  currentIndex: number;
};

type EvaluateChannelPoiTriggersArgs = {
  channel: ChannelModel;
  tfBars: readonly ChannelBar[];
  currentIndex: number;
  atrAtBar: number;
  breakType: ChannelStructureBreakType | null;
  nextState: "UP" | "DOWN" | "MIXED";
};

type EvaluateChannelPoiTriggersFromTfBarsArgs = {
  channel: ChannelModel;
  tfBars: readonly ChannelBar[];
  breakType: ChannelStructureBreakType | null;
  nextState: "UP" | "DOWN" | "MIXED";
};

const ATR_PERIOD = 14;

function assertSameTfAscending(bars: readonly ChannelBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Channel trigger bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Channel trigger bars must be strictly ascending by closeTime");
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

function getChannelTradeDir(channel: ChannelModel): "BULL" | "BEAR" | null {
  if (!channel.geometry) return null;
  return channel.geometry.dir === "UP" ? "BULL" : "BEAR";
}

export function getChannelCandleBodySize(bar: ChannelBar): number {
  return Math.abs(bar.close - bar.open);
}

export function evaluateChannelDispTriggerAtBar(
  args: EvaluateChannelDispTriggerAtBarArgs
): ChannelDispTriggerEvalResult | null {
  const { tfBars, currentIndex, atrAtBar } = args;

  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 2 || currentIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;

  assertSameTfAscending(tfBars);

  const bars = tfBars.slice(currentIndex - 2, currentIndex + 1);
  const bodies = bars.map(getChannelCandleBodySize);

  const bodyMax = Math.max(...bodies);
  const bodySum = bodies.reduce((sum, v) => sum + v, 0);

  const passByMax = bodyMax > atrAtBar * DISP_BODY_MAX_ATR;
  const passBySum = bodySum > atrAtBar * DISP_BODY_SUM_ATR;

  return {
    tf: tfBars[currentIndex].tf as ChannelDispTriggerEvalResult["tf"],
    currentCloseTime: tfBars[currentIndex].closeTime,
    atrAtBar,
    bodyMax,
    bodySum,
    passByMax,
    passBySum,
    passDisp: passByMax || passBySum,
  };
}

export function evaluateChannelDispTriggerFromTfBars(
  tfBars: readonly ChannelBar[]
): ChannelDispTriggerEvalResult | null {
  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtBar = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtBar)) {
    return null;
  }

  return evaluateChannelDispTriggerAtBar({
    tfBars,
    currentIndex: tfBars.length - 1,
    atrAtBar: atrAtBar as number,
  });
}

export function evaluateChannelSweepRecTriggerNow(
  args: EvaluateChannelSweepRecTriggerNowArgs
): boolean {
  const { channel, tfBars, currentIndex } = args;

  if (!Number.isInteger(currentIndex)) return false;
  if (currentIndex < 1 || currentIndex >= tfBars.length) return false;
  if (!channel.geometry) return false;

  assertSameTfAscending(tfBars);

  const prevBar = tfBars[currentIndex - 1];
  const currentBar = tfBars[currentIndex];

  const prevBoundary = getChannelPoiBoundaryPriceAt(
    channel,
    prevBar.closeTime
  );
  const currentBoundary = getChannelPoiBoundaryPriceAt(
    channel,
    currentBar.closeTime
  );

  if (prevBoundary === null || currentBoundary === null) {
    return false;
  }

  if (channel.geometry.dir === "UP") {
    const sweep = prevBar.low < prevBoundary;
    const recovery = currentBar.close >= currentBoundary;
    return sweep && recovery;
  }

  const sweep = prevBar.high > prevBoundary;
  const recovery = currentBar.close <= currentBoundary;
  return sweep && recovery;
}

export function evaluateChannelStructureTrigger(
  channelDir: "UP" | "DOWN",
  breakType: ChannelStructureBreakType | null,
  nextState: "UP" | "DOWN" | "MIXED"
): boolean {
  if (!breakType) {
    return false;
  }

  return channelDir === "UP" ? nextState === "UP" : nextState === "DOWN";
}

export function evaluateChannelPoiTriggers(
  args: EvaluateChannelPoiTriggersArgs
): ChannelPoiTriggerEvalResult | null {
  const { channel, tfBars, currentIndex, atrAtBar, breakType, nextState } = args;

  if (!channel.geometry) return null;
  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= tfBars.length) return null;

  const dir = getChannelTradeDir(channel);
  if (!dir) return null;

  const sweepRec = evaluateChannelSweepRecTriggerNow({
    channel,
    tfBars,
    currentIndex,
  });

  const structure = evaluateChannelStructureTrigger(
    channel.geometry.dir,
    breakType,
    nextState
  );

  const dispEval = evaluateChannelDispTriggerAtBar({
    tfBars,
    currentIndex,
    atrAtBar,
  });

  const disp = Boolean(dispEval?.passDisp);

  const triggers: PoiTrigger[] = [];
  if (sweepRec) triggers.push("sweepRec");
  if (structure) triggers.push("structure");
  if (disp) triggers.push("disp");

  return {
    tf: channel.tf,
    dir,
    currentCloseTime: tfBars[currentIndex].closeTime,
    sweepRec,
    structure,
    disp,
    triggers,
  };
}

export function evaluateChannelPoiTriggersFromTfBars(
  args: EvaluateChannelPoiTriggersFromTfBarsArgs
): ChannelPoiTriggerEvalResult | null {
  const { channel, tfBars, breakType, nextState } = args;

  if (tfBars.length === 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[tfBars.length - 1];
  const atrAtBar = getAtrValueAtCloseTime(tfBars, currentBar.closeTime);

  if (!Number.isFinite(atrAtBar)) {
    return null;
  }

  return evaluateChannelPoiTriggers({
    channel,
    tfBars,
    currentIndex: tfBars.length - 1,
    atrAtBar: atrAtBar as number,
    breakType,
    nextState,
  });
}
