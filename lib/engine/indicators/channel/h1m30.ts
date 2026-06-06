import {
  H1_TTL_BARS,
  M30_TTL_BARS,
  MAX_FORWARD_BARS,
  OFFSET_PCTL_H1,
  OFFSET_PCTL_M30,
} from "./constants";
import { createChannelGeometry } from "./basic";
import type {
  AnchorPoint,
  ChannelDir,
  ChannelMode,
  ChannelModel,
  ChannelType,
} from "./types";

const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

export type H1M30ChannelTf = "H1" | "M30";

type CreateH1M30OperationalChannelArgs = {
  symbol: string;
  tf: H1M30ChannelTf;
  dir: ChannelDir;
  a: AnchorPoint;
  b: AnchorPoint;
  offset: number;
  createdAt: number;
  activeParentPoiCount: number;
  referencedParentIds?: string[];
};

export function isH1M30ChannelTf(tf: string): tf is H1M30ChannelTf {
  return tf === "H1" || tf === "M30";
}

export function getH1M30ChannelType(tf: H1M30ChannelTf): ChannelType {
  return tf === "H1" ? "H1_CHANNEL" : "M30_CHANNEL";
}

export function getH1M30OffsetPercentile(tf: H1M30ChannelTf): 85 | 80 {
  return tf === "H1" ? OFFSET_PCTL_H1 : OFFSET_PCTL_M30;
}

export function getH1M30TtlBars(tf: H1M30ChannelTf): 100 | 80 {
  return tf === "H1" ? H1_TTL_BARS : M30_TTL_BARS;
}

export function computeH1M30Mode(
  activeParentPoiCount: number
): ChannelMode {
  return activeParentPoiCount >= 1 ? "ENABLED" : "CONTEXT_ONLY";
}

export function getH1M30DisplayUntil(
  tf: H1M30ChannelTf,
  createdAt: number
): number {
  const durationMs = tf === "H1" ? H1_BAR_DURATION_MS : M30_BAR_DURATION_MS;
  return createdAt + MAX_FORWARD_BARS * durationMs;
}

export function createH1M30OperationalChannel(
  args: CreateH1M30OperationalChannelArgs
): ChannelModel | null {
  const { symbol, tf, dir, a, b, offset, createdAt, activeParentPoiCount } =
    args;

  const geometry = createChannelGeometry(dir, a, b, offset);
  if (!geometry) {
    return null;
  }

  const type = getH1M30ChannelType(tf);
  const offsetPctl = getH1M30OffsetPercentile(tf);

  return {
    id: `${symbol.toUpperCase()}:${type}:${a.time}:${dir}:${offsetPctl}`,
    symbol: symbol.toUpperCase(),
    type,
    tf,
    state: "ACTIVE",
    mode: computeH1M30Mode(activeParentPoiCount),
    geometry,
    anchorStartTime: a.time,
    anchorEndTime: b.time,
    createdAt,
    lastUpdatedAt: createdAt,
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getH1M30DisplayUntil(tf, createdAt),
    ttlBars: getH1M30TtlBars(tf),
    ttlStartTime: createdAt,
    ...(args.referencedParentIds?.length
      ? { referencedParentIds: [...args.referencedParentIds] }
      : {}),
  };
}
