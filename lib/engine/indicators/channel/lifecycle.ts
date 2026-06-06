import {
  H1_TTL_BARS,
  M30_TTL_BARS,
  POI_CAP_PER_DAY,
} from "./constants";
import type {
  ChannelLifecycleInvalidationEvalResult,
  ChannelModel,
  ChannelPoiDayCapEvalResult,
} from "./types";

const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

export type ChannelTtlTf = "H1" | "M30";

export function isChannelTtlTf(tf: string): tf is ChannelTtlTf {
  return tf === "H1" || tf === "M30";
}

export function getChannelTtlBars(tf: ChannelTtlTf): 100 | 80 {
  return tf === "H1" ? H1_TTL_BARS : M30_TTL_BARS;
}

function getChannelTfDurationMs(tf: ChannelTtlTf): number {
  return tf === "H1" ? H1_BAR_DURATION_MS : M30_BAR_DURATION_MS;
}

export function getChannelTtlExpiryTime(
  channel: ChannelModel
): number | null {
  if (!isChannelTtlTf(channel.tf)) {
    return null;
  }

  if (!Number.isFinite(channel.ttlStartTime) || !Number.isFinite(channel.ttlBars)) {
    return null;
  }

  return (channel.ttlStartTime as number) +
    (channel.ttlBars as number) * getChannelTfDurationMs(channel.tf);
}

export function evaluateChannelTtlExpiration(
  channel: ChannelModel,
  currentCloseTime: number
): boolean {
  const expiryTime = getChannelTtlExpiryTime(channel);

  if (!Number.isFinite(expiryTime)) {
    return false;
  }

  return currentCloseTime >= (expiryTime as number);
}

export function evaluateChannelParentPoiEnded(
  channel: ChannelModel,
  activeParentPoiIds: readonly string[]
): boolean {
  if (!isChannelTtlTf(channel.tf)) {
    return false;
  }

  if (channel.mode !== "ENABLED") {
    return false;
  }

  if (!channel.referencedParentIds?.length) {
    return false;
  }

  const activeSet = new Set(activeParentPoiIds);
  return channel.referencedParentIds.every((id) => !activeSet.has(id));
}

type ResolveChannelLifecycleInvalidationArgs = {
  channel: ChannelModel;
  currentCloseTime: number;
  activeParentPoiIds: readonly string[];
};

export function resolveChannelLifecycleInvalidation(
  args: ResolveChannelLifecycleInvalidationArgs
): ChannelLifecycleInvalidationEvalResult {
  const { channel, currentCloseTime, activeParentPoiIds } = args;

  const ttlExpired = evaluateChannelTtlExpiration(channel, currentCloseTime);
  const parentPoiEnded = !ttlExpired &&
    evaluateChannelParentPoiEnded(channel, activeParentPoiIds);

  const invalidReason = ttlExpired
    ? "ttl_expired"
    : parentPoiEnded
      ? "parent_poi_ended"
      : null;

  return {
    ttlExpired,
    parentPoiEnded,
    invalidated: invalidReason !== null,
    invalidReason,
  };
}

export function applyChannelLifecycleInvalidation(
  args: ResolveChannelLifecycleInvalidationArgs
): ChannelModel {
  const { channel, currentCloseTime } = args;

  if (channel.state !== "ACTIVE") {
    return channel;
  }

  const evaluation = resolveChannelLifecycleInvalidation(args);

  if (!evaluation.invalidated) {
    return channel;
  }

  return {
    ...channel,
    state: "INACTIVE",
    invalidReason: evaluation.invalidReason ?? undefined,
    endTime: currentCloseTime,
  };
}

export function getChannelPoiDayKeyUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function buildChannelPoiCapKey(
  symbol: string,
  tf: "H1" | "M30",
  dayKeyUtc: string
): string {
  return `${symbol.toUpperCase()}:${tf}:${dayKeyUtc}`;
}

export function evaluateChannelPoiDayCap(args: {
  symbol: string;
  tf: "H1" | "M30";
  time: number;
  currentCount: number;
}): ChannelPoiDayCapEvalResult {
  const { symbol, tf, time, currentCount } = args;

  const dayKeyUtc = getChannelPoiDayKeyUtc(time);
  const capKey = buildChannelPoiCapKey(symbol, tf, dayKeyUtc);

  return {
    tf,
    dayKeyUtc,
    capKey,
    currentCount,
    limit: POI_CAP_PER_DAY,
    allowed: currentCount < POI_CAP_PER_DAY,
  };
}
