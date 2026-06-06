import {
  computeAPlusOBAndAFVG,
  updateLockedChannel,
  updateLockedTrendline,
  type Candle,
  type ChannelState,
  type H4Context,
  type TrendlineState,
  type Zone,
} from "./h4-context";

export function createEmptyH4Context(): H4Context {
  return {
    channel: { mode: "none", breakCount: 0 },
    trend: { mode: "none", breakCount: 0 },
    zones: [],
    last4hTime: undefined,
  };
}

export function computeNextH4Context(
  prev: H4Context | null | undefined,
  candles4h: Candle[]
): H4Context {
  const previous = prev ?? createEmptyH4Context();

  const nextChannel: ChannelState = updateLockedChannel(
    previous.channel,
    candles4h
  );
  const nextTrend: TrendlineState = updateLockedTrendline(
    previous.trend,
    candles4h
  );
  const nextZones: Zone[] = computeAPlusOBAndAFVG(
    candles4h,
    nextChannel,
    nextTrend
  );

  return {
    channel: nextChannel,
    trend: nextTrend,
    zones: nextZones,
    last4hTime: candles4h.at(-1)?.time,
  };
}
