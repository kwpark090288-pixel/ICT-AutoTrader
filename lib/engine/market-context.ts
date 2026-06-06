import { getAtrValueAtCloseTime } from "./atr";
import type { Bar, Pivot, PivotType, TF } from "./types";

const FRACTAL_PIVOT_LEN = 3;
const DEFAULT_BAR_LIMIT = 3000;

type MarketBarStore = Map<TF, Bar[]>;

const marketBarsBySymbol = new Map<string, MarketBarStore>();

function getOrCreateSymbolStore(symbol: string): MarketBarStore {
  const key = symbol.toUpperCase();
  const existing = marketBarsBySymbol.get(key);
  if (existing) {
    return existing;
  }

  const created = new Map<TF, Bar[]>();
  marketBarsBySymbol.set(key, created);
  return created;
}

function assertSameTfAscending(bars: readonly Bar[]) {
  if (bars.length === 0) {
    return;
  }

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Market bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Market bars must be strictly ascending by closeTime");
    }
  }
}

export function clearMarketContext(symbol?: string): void {
  if (symbol) {
    marketBarsBySymbol.delete(symbol.toUpperCase());
    return;
  }

  marketBarsBySymbol.clear();
}

export function appendMarketBar(
  symbol: string,
  bar: Bar,
  maxBars: number = DEFAULT_BAR_LIMIT
): Bar[] {
  const symbolStore = getOrCreateSymbolStore(symbol);
  const current = symbolStore.get(bar.tf) ?? [];

  if (current.length > 0) {
    const last = current[current.length - 1];

    if (bar.closeTime <= last.closeTime) {
      return [...current];
    }
  }

  const next = [...current, bar];
  const trimmed = next.length > maxBars ? next.slice(next.length - maxBars) : next;
  symbolStore.set(bar.tf, trimmed);
  return [...trimmed];
}

export function getMarketBars(
  symbol: string,
  tf: TF
): Bar[] {
  const symbolStore = marketBarsBySymbol.get(symbol.toUpperCase());
  if (!symbolStore) {
    return [];
  }

  return [...(symbolStore.get(tf) ?? [])];
}

export function getMarketBarAtCloseTime(
  symbol: string,
  tf: TF,
  closeTime: number
): Bar | null {
  const bars = getMarketBars(symbol, tf);
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (bars[i].closeTime === closeTime) {
      return bars[i];
    }
    if (bars[i].closeTime < closeTime) {
      break;
    }
  }
  return null;
}

export function getMarketAtr14AtCloseTime(
  symbol: string,
  tf: TF,
  closeTime: number
): number | null {
  return getAtrValueAtCloseTime(getMarketBars(symbol, tf), closeTime);
}

export function getMarketAtr14AtOrBeforeCloseTime(
  symbol: string,
  tf: TF,
  closeTime: number
): number | null {
  const bars = getMarketBars(symbol, tf);

  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (bars[i].closeTime <= closeTime) {
      return getAtrValueAtCloseTime(bars, bars[i].closeTime);
    }
  }

  return null;
}

export function detectConfirmedFractalPivotAtIndex(
  bars: readonly Bar[],
  pivotType: PivotType,
  pivotIndex: number,
  pivotLen: number = FRACTAL_PIVOT_LEN
): Pivot | null {
  if (!Number.isInteger(pivotIndex) || pivotIndex < 0) {
    return null;
  }

  if (bars.length === 0) {
    return null;
  }

  assertSameTfAscending(bars);

  const center = bars[pivotIndex];
  if (!center) {
    return null;
  }

  const leftStart = pivotIndex - pivotLen;
  const rightEnd = pivotIndex + pivotLen;

  if (leftStart < 0 || rightEnd >= bars.length) {
    return null;
  }

  if (pivotType === "HIGH") {
    for (let i = leftStart; i <= rightEnd; i += 1) {
      if (i === pivotIndex) {
        continue;
      }

      if (center.high <= bars[i].high) {
        return null;
      }
    }

    return {
      tf: center.tf,
      pivotType: "HIGH",
      pivotTime: center.closeTime,
      pivotPrice: center.high,
      confirmedAt: bars[rightEnd].closeTime,
      isConfirmed: true,
    };
  }

  for (let i = leftStart; i <= rightEnd; i += 1) {
    if (i === pivotIndex) {
      continue;
    }

    if (center.low >= bars[i].low) {
      return null;
    }
  }

  return {
    tf: center.tf,
    pivotType: "LOW",
    pivotTime: center.closeTime,
    pivotPrice: center.low,
    confirmedAt: bars[rightEnd].closeTime,
    isConfirmed: true,
  };
}

export function listConfirmedFractalPivots(
  symbol: string,
  tf: TF
): Pivot[] {
  const bars = getMarketBars(symbol, tf);
  const out: Pivot[] = [];

  for (let i = 0; i < bars.length; i += 1) {
    const high = detectConfirmedFractalPivotAtIndex(bars, "HIGH", i);
    if (high) {
      out.push(high);
    }

    const low = detectConfirmedFractalPivotAtIndex(bars, "LOW", i);
    if (low) {
      out.push(low);
    }
  }

  return out.sort((a, b) => a.confirmedAt - b.confirmedAt);
}

export function listConfirmedFractalPivotsBeforeCloseTime(
  symbol: string,
  tf: TF,
  closeTime: number
): Pivot[] {
  return listConfirmedFractalPivots(symbol, tf).filter(
    (pivot) => pivot.confirmedAt < closeTime
  );
}
