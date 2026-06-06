import {
  BOOK_TICKER_STALE_MAX_MS,
  getFreshBookTicker,
} from "../engine/book-ticker";
import {
  getMarketAtr14AtCloseTime,
  getMarketBars,
} from "../engine/market-context";
import type { Bar } from "../engine/types";
import type { AccountSnapshot, MarketSnapshot, PolicyDataState } from "./types";

const DEFAULT_ALERT_ONLY_EQUITY_USD = 10_000;

export type RuntimePolicySyncState = {
  syncing: boolean;
  dataOk: boolean;
  gapDetected: boolean;
  syncSource?: string | null;
};

function isFinitePositive(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function findLatestClosedM5BarAtOrBefore(
  symbol: string,
  openTimeMs: number
): Bar | null {
  const bars = getMarketBars(symbol, "M5");
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    if (bars[i].closeTime <= openTimeMs) {
      return bars[i];
    }
  }
  return null;
}

function computeBarChangeBpsM5(bar: Bar): number | null {
  if (!isFinitePositive(bar.open)) {
    return null;
  }

  return (Math.abs(bar.close - bar.open) / bar.open) * 10_000;
}

function computeAtrBps(atr14Price: number, closePrice: number): number | null {
  if (!isFinitePositive(atr14Price) || !isFinitePositive(closePrice)) {
    return null;
  }

  return (atr14Price / closePrice) * 10_000;
}

function resolveRuntimeDataState(args: {
  syncState?: RuntimePolicySyncState | null;
  hasM5Context: boolean;
  hasFreshBbo: boolean;
}): {
  dataOk: boolean;
  dataReason: MarketSnapshot["dataReason"];
  dataState?: PolicyDataState;
} {
  const { syncState, hasM5Context, hasFreshBbo } = args;

  if (syncState?.syncing) {
    if (syncState.gapDetected || syncState.syncSource === "GAP_REPLAY") {
      return {
        dataOk: false,
        dataReason: "GAP_SYNCING",
        dataState: "GAP_DETECTED",
      };
    }

    return {
      dataOk: false,
      dataReason: "BOOTSTRAP_WARMING",
      dataState: "BACKFILLING",
    };
  }

  if (!hasM5Context) {
    return {
      dataOk: false,
      dataReason: "M5_NOT_READY",
      dataState: "BACKFILLING",
    };
  }

  if (!hasFreshBbo) {
    return {
      dataOk: false,
      dataReason: "STALE_BBO",
    };
  }

  return {
    dataOk: true,
    dataReason: "OK",
    dataState: "OK",
  };
}

export function buildRuntimeMarketSnapshot(args: {
  symbol: string;
  openTime: string;
  lastPrice: number;
  syncState?: RuntimePolicySyncState | null;
  bboStaleMaxMs?: number;
}): MarketSnapshot | null {
  const symbol = args.symbol.toUpperCase();
  const openTimeMs = Date.parse(args.openTime);
  const lastPrice = Number(args.lastPrice);

  if (!symbol || !Number.isFinite(openTimeMs) || !isFinitePositive(lastPrice)) {
    return null;
  }

  const latestClosedM5Bar = findLatestClosedM5BarAtOrBefore(symbol, openTimeMs);
  const atr14Price =
    latestClosedM5Bar
      ? getMarketAtr14AtCloseTime(symbol, "M5", latestClosedM5Bar.closeTime)
      : null;
  const atr14Bps =
    latestClosedM5Bar && Number.isFinite(atr14Price)
      ? computeAtrBps(atr14Price as number, latestClosedM5Bar.close)
      : null;
  const barChangeBpsM5 =
    latestClosedM5Bar ? computeBarChangeBpsM5(latestClosedM5Bar) : null;

  const freshBookTicker = getFreshBookTicker(
    symbol,
    openTimeMs,
    args.bboStaleMaxMs ?? BOOK_TICKER_STALE_MAX_MS
  );
  const hasM5Context =
    Boolean(latestClosedM5Bar) &&
    Number.isFinite(atr14Price) &&
    Number.isFinite(atr14Bps) &&
    Number.isFinite(barChangeBpsM5);
  const hasFreshBbo = Boolean(freshBookTicker);
  const data = resolveRuntimeDataState({
    syncState: args.syncState,
    hasM5Context,
    hasFreshBbo,
  });

  const bid = freshBookTicker?.bid ?? null;
  const ask = freshBookTicker?.ask ?? null;
  const mid =
    freshBookTicker ? (freshBookTicker.bid + freshBookTicker.ask) / 2 : lastPrice;

  return {
    time: args.openTime,
    symbol,
    bid,
    ask,
    last: lastPrice,
    mid,
    atr14_price: hasM5Context ? (atr14Price as number) : null,
    atr14_bps: hasM5Context ? (atr14Bps as number) : null,
    volume_m5: latestClosedM5Bar?.volume ?? null,
    barChange_bps_m5: hasM5Context ? (barChangeBpsM5 as number) : null,
    dataOk: data.dataOk,
    dataReason: data.dataReason,
    dataState: data.dataState,
  };
}

export function buildRuntimeAlertOnlyAccountSnapshot(args: {
  openTime: string;
  equityRefUsd?: number;
}): AccountSnapshot | null {
  return buildRuntimeAlertOnlyAccountSnapshotFromState({
    openTime: args.openTime,
    equityRefUsd: args.equityRefUsd,
    riskMode: "NORMAL",
    realizedPnl24hPct: 0,
    consecutiveLosses: 0,
    openRiskPct: 0,
    accountDataQuality: "STATIC",
  });
}

export function buildRuntimeAlertOnlyAccountSnapshotFromState(args: {
  openTime: string;
  equityRefUsd?: number;
  riskMode: AccountSnapshot["riskMode"];
  realizedPnl24hPct: number;
  consecutiveLosses: number;
  openRiskPct: number;
  accountDataQuality?: AccountSnapshot["accountDataQuality"];
}): AccountSnapshot | null {
  const openTimeMs = Date.parse(args.openTime);
  if (!Number.isFinite(openTimeMs)) {
    return null;
  }

  return {
    time: args.openTime,
    equity:
      isFinitePositive(args.equityRefUsd) ? args.equityRefUsd : DEFAULT_ALERT_ONLY_EQUITY_USD,
    riskMode: args.riskMode,
    realizedPnl_24h_pct: args.realizedPnl24hPct,
    consecutiveLosses: args.consecutiveLosses,
    openRiskPct: args.openRiskPct,
    accountMode: "ALERT_ONLY",
    accountDataQuality: args.accountDataQuality ?? "STATIC",
  };
}
