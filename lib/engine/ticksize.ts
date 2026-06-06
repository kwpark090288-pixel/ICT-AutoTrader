const BINANCE_FAPI_EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo";

type ExchangeInfoResponse = {
  symbols?: Array<{
    symbol?: string;
    filters?: Array<{
      filterType?: string;
      tickSize?: string;
    }>;
  }>;
};

const tickSizeCache = new Map<string, number>();

export function getCachedTickSize(symbol: string): number | undefined {
  return tickSizeCache.get(symbol.toUpperCase());
}

export function setCachedTickSize(symbol: string, tickSize: number): void {
  const key = symbol.toUpperCase();
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    tickSizeCache.delete(key);
    return;
  }
  tickSizeCache.set(key, tickSize);
}

export function getCachedTickSizeOrThrow(symbol: string): number {
  const value = getCachedTickSize(symbol);
  if (!Number.isFinite(value)) {
    throw new Error(`tickSize missing for symbol=${symbol}`);
  }
  return value as number;
}

export function dumpTickSizeCache(): Array<{ symbol: string; tickSize: number }> {
  return [...tickSizeCache.entries()].map(([symbol, tickSize]) => ({
    symbol,
    tickSize,
  }));
}

export async function loadTickSize(symbol: string): Promise<number> {
  const key = symbol.toUpperCase();

  const cached = tickSizeCache.get(key);
  if (Number.isFinite(cached)) {
    return cached as number;
  }

  const res = await fetch(`${BINANCE_FAPI_EXCHANGE_INFO_URL}?symbol=${key}`);
  if (!res.ok) {
    throw new Error(`loadTickSize failed: symbol=${key} status=${res.status}`);
  }

  const json = (await res.json()) as ExchangeInfoResponse;
  const row = json.symbols?.find((s) => s.symbol === key);
  const priceFilter = row?.filters?.find((f) => f.filterType === "PRICE_FILTER");
  const tickSize = Number(priceFilter?.tickSize);

  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new Error(`Invalid tickSize for symbol=${key}`);
  }

  tickSizeCache.set(key, tickSize);
  return tickSize;
}

export async function preloadTickSizes(symbols: string[]): Promise<void> {
  for (const symbol of symbols) {
    await loadTickSize(symbol);
  }
}
