export const BOOK_TICKER_STALE_MAX_MS = 3000;

export interface BookTickerSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  eventTime: number | null;
  recvTime: number;
}

const latestBookTickerBySymbol = new Map<string, BookTickerSnapshot>();

function getEffectiveTime(snapshot: BookTickerSnapshot): number {
  return snapshot.eventTime ?? snapshot.recvTime;
}

export function clearBookTickerCache(symbol?: string): void {
  if (symbol) {
    latestBookTickerBySymbol.delete(symbol.toUpperCase());
    return;
  }

  latestBookTickerBySymbol.clear();
}

export function upsertBookTicker(args: {
  symbol: string;
  bid: number;
  ask: number;
  eventTime?: number | null;
  recvTime?: number;
}): BookTickerSnapshot | null {
  const symbol = args.symbol.toUpperCase();
  const bid = Number(args.bid);
  const ask = Number(args.ask);
  const recvTime = Number.isFinite(args.recvTime) ? (args.recvTime as number) : Date.now();
  const eventTime = Number.isFinite(args.eventTime) ? (args.eventTime as number) : null;

  if (!symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    return null;
  }

  const next: BookTickerSnapshot = {
    symbol,
    bid,
    ask,
    eventTime,
    recvTime,
  };

  latestBookTickerBySymbol.set(symbol, next);
  return next;
}

export function getLatestBookTicker(symbol: string): BookTickerSnapshot | null {
  return latestBookTickerBySymbol.get(symbol.toUpperCase()) ?? null;
}

export function getFreshBookTicker(
  symbol: string,
  atTimeMs: number,
  staleMaxMs: number = BOOK_TICKER_STALE_MAX_MS
): BookTickerSnapshot | null {
  const latest = getLatestBookTicker(symbol);
  if (!latest) {
    return null;
  }

  const effectiveTime = getEffectiveTime(latest);
  if (!Number.isFinite(effectiveTime) || effectiveTime > atTimeMs) {
    return null;
  }

  if (atTimeMs - effectiveTime > staleMaxMs) {
    return null;
  }

  return latest;
}

