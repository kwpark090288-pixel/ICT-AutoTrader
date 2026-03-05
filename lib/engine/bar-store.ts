import type { Bar } from "./types";

export type TfKey = Bar["tf"];
export type TfBarStore = Map<TfKey, Bar[]>;

const EMPTY_BARS: readonly Bar[] = [];

export function clampBarsToLookback(
  bars: readonly Bar[],
  lookback: number
): Bar[] {
  if (!Number.isInteger(lookback) || lookback <= 0) {
    throw new Error(`invalid lookback: ${lookback}`);
  }

  if (bars.length <= lookback) {
    return [...bars];
  }

  return bars.slice(bars.length - lookback);
}

export function createTfBarStore(): TfBarStore {
  return new Map<TfKey, Bar[]>();
}

export function getBarsForTf(
  store: TfBarStore,
  tf: TfKey
): readonly Bar[] {
  return store.get(tf) ?? EMPTY_BARS;
}

export function getBarCountForTf(store: TfBarStore, tf: TfKey): number {
  return store.get(tf)?.length ?? 0;
}

export function setBarsForTf(
  store: TfBarStore,
  tf: TfKey,
  bars: readonly Bar[],
  lookback: number
): readonly Bar[] {
  const next = clampBarsToLookback(bars, lookback);
  store.set(tf, next);
  return next;
}

export function appendBarForTf(
  store: TfBarStore,
  bar: Bar,
  lookback: number
): readonly Bar[] {
  const prev = store.get(bar.tf) ?? [];
  const next = clampBarsToLookback([...prev, bar], lookback);
  store.set(bar.tf, next);
  return next;
}
