import {
  MAX_FORWARD_BARS,
  OFFSET_PCTL_D1,
  OFFSET_PCTL_H4,
} from "./constants";
import type {
  AnchorPoint,
  ChannelDir,
  ChannelGeometry,
  ChannelMode,
  ChannelModel,
  ChannelType,
  Line2P,
} from "./types";

const D1_BAR_DURATION_MS = 24 * 60 * 60 * 1000;
const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

export type D1H4ChannelTf = "D1" | "H4";

type CreateD1H4OperationalChannelArgs = {
  symbol: string;
  tf: D1H4ChannelTf;
  dir: ChannelDir;
  a: AnchorPoint;
  b: AnchorPoint;
  offset: number;
  createdAt: number;
};

export function isD1H4ChannelTf(tf: string): tf is D1H4ChannelTf {
  return tf === "D1" || tf === "H4";
}

export function getD1H4ChannelType(tf: D1H4ChannelTf): ChannelType {
  return tf === "D1" ? "D1_CHANNEL" : "H4_CHANNEL";
}

export function getD1H4OffsetPercentile(tf: D1H4ChannelTf): 95 | 90 {
  return tf === "D1" ? OFFSET_PCTL_D1 : OFFSET_PCTL_H4;
}

export function getD1H4FixedMode(_tf: D1H4ChannelTf): ChannelMode {
  return "ENABLED";
}

export function buildAnchorLine2P(
  a: AnchorPoint,
  b: AnchorPoint
): Line2P | null {
  if (!(b.time > a.time)) {
    return null;
  }

  const slope = (b.price - a.price) / (b.time - a.time);
  const intercept = a.price - slope * a.time;

  return {
    a,
    b,
    slope,
    intercept,
  };
}

export function linePriceAt(
  line: Line2P,
  time: number
): number {
  return line.slope * time + line.intercept;
}

export function createChannelGeometry(
  dir: ChannelDir,
  a: AnchorPoint,
  b: AnchorPoint,
  offset: number
): ChannelGeometry | null {
  if (!Number.isFinite(offset) || offset <= 0) {
    return null;
  }

  const anchorLine = buildAnchorLine2P(a, b);
  if (!anchorLine) {
    return null;
  }

  return {
    dir,
    anchorLine,
    offset,
    midOffset: offset * 0.5,
  };
}

export function getD1H4DisplayUntil(
  tf: D1H4ChannelTf,
  createdAt: number
): number {
  const durationMs =
    tf === "D1" ? D1_BAR_DURATION_MS : H4_BAR_DURATION_MS;

  return createdAt + MAX_FORWARD_BARS * durationMs;
}

export function createD1H4OperationalChannel(
  args: CreateD1H4OperationalChannelArgs
): ChannelModel | null {
  const { symbol, tf, dir, a, b, offset, createdAt } = args;

  const geometry = createChannelGeometry(dir, a, b, offset);
  if (!geometry) {
    return null;
  }

  const type = getD1H4ChannelType(tf);
  const offsetPctl = getD1H4OffsetPercentile(tf);

  return {
    id: `${symbol.toUpperCase()}:${type}:${a.time}:${dir}:${offsetPctl}`,
    symbol: symbol.toUpperCase(),
    type,
    tf,
    state: "ACTIVE",
    mode: getD1H4FixedMode(tf),
    geometry,
    anchorStartTime: a.time,
    anchorEndTime: b.time,
    createdAt,
    lastUpdatedAt: createdAt,
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getD1H4DisplayUntil(tf, createdAt),
  };
}
