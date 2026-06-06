import { formatPriceByTick, normalizeByTick } from "../../tick";
import { linePriceAt } from "./basic";
import { getD1H4OffsetPercentile } from "./basic";
import { getH1M30OffsetPercentile, isH1M30ChannelTf } from "./h1m30";
import type { ChannelModel, ChannelPoi } from "./types";

function formatIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function formatFixed2(value: number): string {
  return value.toFixed(2);
}

function getChannelBoundsAt(
  model: ChannelModel,
  time: number
): { lower: number; upper: number } | null {
  if (!model.geometry) {
    return null;
  }

  const anchorPrice = linePriceAt(model.geometry.anchorLine, time);
  if (model.geometry.dir === "UP") {
    return {
      lower: anchorPrice,
      upper: anchorPrice + model.geometry.offset,
    };
  }

  return {
    lower: anchorPrice - model.geometry.offset,
    upper: anchorPrice,
  };
}

function formatChannelUpdatePayload(
  model: ChannelModel,
  time: number,
  tickSize: number | null
): { lower: string; upper: string; offset: string } | null {
  const bounds = getChannelBoundsAt(model, time);
  if (!bounds) {
    return null;
  }

  const tick =
    Number.isFinite(tickSize) && (tickSize as number) > 0
      ? (tickSize as number)
      : null;

  if (!tick) {
    return {
      lower: formatFixed2(bounds.lower),
      upper: formatFixed2(bounds.upper),
      offset: formatFixed2(bounds.upper - bounds.lower),
    };
  }

  const normalized = normalizeByTick(bounds.lower, bounds.upper, tick);

  return {
    lower: formatPriceByTick(normalized.bottomNorm, tick),
    upper: formatPriceByTick(normalized.topNorm, tick),
    offset: formatPriceByTick(
      normalized.topNorm - normalized.bottomNorm,
      tick
    ),
  };
}

function getGeometryOffsetTickValue(
  model: ChannelModel,
  tickSize: number | null
): number {
  if (!model.geometry) {
    return Number.NaN;
  }

  const tick =
    Number.isFinite(tickSize) && (tickSize as number) > 0
      ? (tickSize as number)
      : null;

  if (!tick) {
    return model.geometry.offset;
  }

  return normalizeByTick(0, model.geometry.offset, tick).topNorm;
}

function getChannelOffsetPercentileForEvent(
  tf: "D1" | "H4" | "H1" | "M30"
): number {
  if (tf === "D1" || tf === "H4") {
    return getD1H4OffsetPercentile(tf);
  }

  return getH1M30OffsetPercentile(tf);
}

export function formatChannelNewEvent(
  time: number,
  model: ChannelModel
): string | null {
  if (model.state !== "ACTIVE" || !model.geometry) {
    return null;
  }

  if (
    model.anchorStartTime === undefined ||
    model.anchorEndTime === undefined
  ) {
    return null;
  }

  return `[CHANNEL][NEW][${model.tf}][${model.geometry.dir}] time=${formatIsoUtcSecond(time)} anchors=${model.geometry.anchorLine.a.time}@${model.geometry.anchorLine.a.price},${model.geometry.anchorLine.b.time}@${model.geometry.anchorLine.b.price} offsetPctl=${getChannelOffsetPercentileForEvent(model.tf)} offset=${formatFixed2(model.geometry.offset)} mid=${formatFixed2(model.geometry.midOffset)}`;
}

export function shouldEmitChannelNewEvent(
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): boolean {
  if (!nextModel || nextModel.state !== "ACTIVE") {
    return false;
  }

  if (!prevModel) {
    return true;
  }

  if (prevModel.state !== "ACTIVE") {
    return true;
  }

  return prevModel.id !== nextModel.id;
}

export function resolveChannelNewEvent(
  time: number,
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): string | null {
  if (!shouldEmitChannelNewEvent(prevModel, nextModel)) {
    return null;
  }

  return formatChannelNewEvent(time, nextModel as ChannelModel);
}

export function formatChannelInvalidEvent(
  time: number,
  model: ChannelModel
): string | null {
  if (model.state !== "INACTIVE") {
    return null;
  }

  if (!model.invalidReason || !model.endTime) {
    return null;
  }

  return `[CHANNEL][INVALID][${model.tf}][${model.id}] time=${formatIsoUtcSecond(time)} reason=${model.invalidReason} endTime=${formatIsoUtcSecond(model.endTime)}`;
}

export function formatChannelUpdateEvent(
  time: number,
  model: ChannelModel,
  tickSize: number | null
): string | null {
  if (model.state !== "ACTIVE" || !model.geometry) {
    return null;
  }

  const payload = formatChannelUpdatePayload(model, time, tickSize);
  if (!payload) {
    return null;
  }

  return `[UPDATE][${model.tf}][CHANNEL][${model.geometry.dir}] id=${model.id} reason=geometry lower=${payload.lower} upper=${payload.upper} offset=${payload.offset}`;
}

export function shouldEmitChannelInvalidEvent(
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): boolean {
  if (!prevModel || !nextModel) {
    return false;
  }

  return prevModel.state === "ACTIVE" && nextModel.state === "INACTIVE";
}

export function shouldEmitChannelUpdateEvent(args: {
  prevModel?: ChannelModel | null;
  nextModel?: ChannelModel | null;
  tickSize?: number | null;
  suppressForModeChange?: boolean;
}): boolean {
  const { prevModel, nextModel, tickSize, suppressForModeChange } = args;

  if (!prevModel || !nextModel) {
    return false;
  }

  if (prevModel.state !== "ACTIVE" || nextModel.state !== "ACTIVE") {
    return false;
  }

  if (prevModel.id !== nextModel.id) {
    return false;
  }

  if (!prevModel.geometry || !nextModel.geometry) {
    return false;
  }

  if (suppressForModeChange) {
    return false;
  }

  return (
    getGeometryOffsetTickValue(prevModel, tickSize ?? null) !==
    getGeometryOffsetTickValue(nextModel, tickSize ?? null)
  );
}

export function resolveChannelInvalidEvent(
  time: number,
  prevModel?: ChannelModel | null,
  nextModel?: ChannelModel | null
): string | null {
  if (!shouldEmitChannelInvalidEvent(prevModel, nextModel)) {
    return null;
  }

  return formatChannelInvalidEvent(time, nextModel as ChannelModel);
}

export function resolveChannelUpdateEvent(args: {
  time: number;
  prevModel?: ChannelModel | null;
  nextModel?: ChannelModel | null;
  tickSize?: number | null;
  suppressForModeChange?: boolean;
}): string | null {
  if (!shouldEmitChannelUpdateEvent(args)) {
    return null;
  }

  return formatChannelUpdateEvent(
    args.time,
    args.nextModel as ChannelModel,
    args.tickSize ?? null
  );
}

export function formatChannelPoiEvent(
  time: number,
  poi: ChannelPoi
): string | null {
  if (poi.state !== "ACTIVE") {
    return null;
  }

  return `[CHANNEL][POI][${poi.tf}][${poi.dir}] time=${formatIsoUtcSecond(time)} boundary=${poi.boundaryPrice} triggers=${poi.triggers.join("|")}`;
}

export function shouldEmitChannelPoiEvent(
  prevPoi?: ChannelPoi | null,
  nextPoi?: ChannelPoi | null
): boolean {
  if (!nextPoi || nextPoi.state !== "ACTIVE") {
    return false;
  }

  if (!prevPoi) {
    return true;
  }

  if (prevPoi.state !== "ACTIVE") {
    return true;
  }

  return prevPoi.id !== nextPoi.id;
}

export function resolveChannelPoiEvent(
  time: number,
  prevPoi?: ChannelPoi | null,
  nextPoi?: ChannelPoi | null
): string | null {
  if (!shouldEmitChannelPoiEvent(prevPoi, nextPoi)) {
    return null;
  }

  return formatChannelPoiEvent(time, nextPoi as ChannelPoi);
}
