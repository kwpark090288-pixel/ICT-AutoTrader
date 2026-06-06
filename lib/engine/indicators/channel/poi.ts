import {
  PARENT_INSIDE_RATIO,
  PARENT_NEAR_ATR,
} from "./constants";
import { getChannelPoiGateAtrMultiplier } from "./poi-gate";
import type {
  ChannelModel,
  ChannelParentNearInsideEvalResult,
  ChannelParentPoiContext,
  ChannelPoi,
  ChannelPoiDayCapEvalResult,
  ChannelPoiGateEvalResult,
  ChannelPoiTriggerEvalResult,
  Zone,
} from "./types";

type CreateChannelPoiArgs = {
  channel: ChannelModel;
  gateEval: ChannelPoiGateEvalResult | null;
  triggerEval: ChannelPoiTriggerEvalResult | null;
  parentNearInsideEval?: ChannelParentNearInsideEvalResult | null;
  dayCapEval?: ChannelPoiDayCapEvalResult | null;
};

function getChannelTradeDir(channel: ChannelModel): "BULL" | "BEAR" | null {
  if (!channel.geometry) return null;
  return channel.geometry.dir === "UP" ? "BULL" : "BEAR";
}

function computeOverlapLen(a: Zone, b: Zone): number {
  return Math.max(0, Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom));
}

function computeOverlapRatio(a: Zone, b: Zone): number {
  const overlapLen = computeOverlapLen(a, b);
  const minHeight = Math.min(a.height, b.height);

  if (!(minHeight > 0)) {
    return 0;
  }

  return overlapLen / minHeight;
}

export function countSatisfiedChannelPoiTriggers(
  triggerEval: ChannelPoiTriggerEvalResult
): number {
  return triggerEval.triggers.length;
}

export function buildChannelBoundaryZoneProxy(
  tf: "H1" | "M30",
  boundaryPrice: number,
  atrAtBar: number
): Zone {
  const gate = atrAtBar * getChannelPoiGateAtrMultiplier(tf);

  return {
    bottom: boundaryPrice - gate,
    top: boundaryPrice + gate,
    height: gate * 2,
  };
}

export function evaluateChannelParentNearInside(args: {
  tf: "H1" | "M30";
  wickExtreme: number;
  boundaryPrice: number;
  atrAtBar: number;
  parentPois: readonly ChannelParentPoiContext[];
}): ChannelParentNearInsideEvalResult {
  const { tf, wickExtreme, boundaryPrice, atrAtBar, parentPois } = args;

  const nearThreshold = atrAtBar * PARENT_NEAR_ATR;
  const boundaryZoneProxy = buildChannelBoundaryZoneProxy(
    tf,
    boundaryPrice,
    atrAtBar
  );

  const near = parentPois.some(
    (parent) => Math.abs(wickExtreme - parent.boundaryPrice) <= nearThreshold
  );

  const inside = parentPois.some(
    (parent) =>
      computeOverlapRatio(parent.zone, boundaryZoneProxy) >= PARENT_INSIDE_RATIO
  );

  return {
    near,
    inside,
    pass: near || inside,
  };
}

export function createChannelPoi(
  args: CreateChannelPoiArgs
): ChannelPoi | null {
  const { channel, gateEval, triggerEval, parentNearInsideEval, dayCapEval } =
    args;

  if (!gateEval || !gateEval.passGate) {
    return null;
  }

  if (!triggerEval) {
    return null;
  }

  if (channel.tf !== gateEval.tf || channel.tf !== triggerEval.tf) {
    return null;
  }

  const dir = getChannelTradeDir(channel);
  if (!dir || dir !== gateEval.dir || dir !== triggerEval.dir) {
    return null;
  }

  const triggerCount = countSatisfiedChannelPoiTriggers(triggerEval);

  if (channel.tf === "D1" || channel.tf === "H4") {
    if (triggerCount < 2) {
      return null;
    }

    return {
      id: `${channel.symbol}:CH_POI:${channel.tf}:${gateEval.currentCloseTime}:${dir}:${gateEval.boundaryPrice}`,
      symbol: channel.symbol,
      tf: channel.tf,
      dir,
      createdAt: gateEval.currentCloseTime,
      boundaryPrice: gateEval.boundaryPrice,
      triggers: [...triggerEval.triggers],
      state: "ACTIVE",
    };
  }

  if (channel.tf !== "H1" && channel.tf !== "M30") {
    return null;
  }

  if (channel.mode !== "ENABLED") {
    return null;
  }

  if (triggerCount !== 3) {
    return null;
  }

  if (!parentNearInsideEval?.pass) {
    return null;
  }

  if (!dayCapEval?.allowed) {
    return null;
  }

  return {
    id: `${channel.symbol}:CH_POI:${channel.tf}:${gateEval.currentCloseTime}:${dir}:${gateEval.boundaryPrice}`,
    symbol: channel.symbol,
    tf: channel.tf,
    dir,
    createdAt: gateEval.currentCloseTime,
    boundaryPrice: gateEval.boundaryPrice,
    triggers: [...triggerEval.triggers],
    state: "ACTIVE",
    dayKeyUtc: dayCapEval.dayKeyUtc,
    parentRelation: parentNearInsideEval.inside
      ? "INSIDE"
      : parentNearInsideEval.near
        ? "NEAR"
        : undefined,
  };
}
