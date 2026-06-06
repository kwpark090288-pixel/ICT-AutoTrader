import { getRuntimePoiStore } from "../engine/runtime-poi-store";
import { getCachedTickSize } from "../engine/ticksize";
import type { Bar } from "../engine/types";
import {
  toRouterRawSignalCandidate,
  type RouterRawPoiStore,
  type RouterRawSignalCandidate,
} from "./raw-event";

export interface BuildRouterRawSignalCandidatesArgs {
  symbol: string;
  bar: Bar;
  rawEvents: readonly string[];
  tickSize?: number;
  poiStore?: RouterRawPoiStore;
}

function resolveTickSize(symbol: string, tickSize?: number): number | null {
  if (Number.isFinite(tickSize) && (tickSize as number) > 0) {
    return tickSize as number;
  }

  const cached = getCachedTickSize(symbol);
  return Number.isFinite(cached) && (cached as number) > 0
    ? (cached as number)
    : null;
}

export function buildRouterRawSignalCandidatesForBar(
  args: BuildRouterRawSignalCandidatesArgs
): RouterRawSignalCandidate[] {
  const { symbol, bar, rawEvents } = args;
  if (!rawEvents.length) {
    return [];
  }

  const tickSize = resolveTickSize(symbol, args.tickSize);
  if (!tickSize) {
    return [];
  }

  const poiStore = args.poiStore ?? getRuntimePoiStore(symbol);

  return rawEvents
    .map((rawEvent) =>
      toRouterRawSignalCandidate(rawEvent, {
        symbol,
        tickSize,
        poiStore,
        bar: {
          closeTime: bar.closeTime,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          closePriceBasis: bar.close,
        },
      })
    )
    .filter(
      (candidate) =>
        !(
          candidate &&
          candidate.poiKind === "CHANNEL" &&
          candidate.eventName === "REACTION"
        )
    )
    .filter((candidate): candidate is RouterRawSignalCandidate => Boolean(candidate));
}
