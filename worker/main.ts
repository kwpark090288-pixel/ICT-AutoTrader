import "dotenv/config";
import { createHash } from "node:crypto";
import WebSocket from "ws";

import { getOrInitEngine } from "../lib/engine/runtime";
import { intervalToTF, tfDurationMs } from "../lib/engine/binance";
import { toIsoUtc } from "../lib/engine/time";
import { dumpTickSizeCache, preloadTickSizes } from "../lib/engine/ticksize";
import { dumpPriceBasisLock } from "../lib/engine/price-basis";
import { appendSignalEvents } from "../lib/engine/event-sink";
import {
  getSendOpenBlockReason,
  isSendOpenBlocked,
} from "../lib/engine/send-open-guard";
import type { Bar } from "../lib/engine/types";

type TfKey = "D1" | "H4" | "H1" | "M30" | "M15" | "M5";

type WsCombinedKlineMessage = {
  stream: string;
  data?: {
    e?: "kline";
    k?: {
      s: string;
      t: number; // open time ms
      T?: number; // close time ms
      o: string;
      h: string;
      l: string;
      c: string;
      x: boolean; // candle closed
    };
  };
};

const TF_SET: TfKey[] = ["D1", "H4", "H1", "M30", "M15", "M5"];

const TF_TO_BINANCE: Record<TfKey, string> = {
  D1: "1d",
  H4: "4h",
  H1: "1h",
  M30: "30m",
  M15: "15m",
  M5: "5m",
};

const LOOKBACK: Record<TfKey, number> = {
  D1: Number(process.env.LOOKBACK_D1 ?? 400),
  H4: Number(process.env.LOOKBACK_H4 ?? 600),
  H1: Number(process.env.LOOKBACK_H1 ?? 1000),
  M30: Number(process.env.LOOKBACK_M30 ?? 1200),
  M15: Number(process.env.LOOKBACK_M15 ?? 1500),
  M5: Number(process.env.LOOKBACK_M5 ?? 3000),
};

const WATCHLIST = String(process.env.WATCHLIST ?? "BTCUSDT,ETHUSDT,SOLUSDT")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const D1_DAYKEY_TZ = String(process.env.D1_DAYKEY_TZ ?? "UTC").toUpperCase();

type SyncSource = "NONE" | "BOOTSTRAP" | "GAP_REPLAY" | "RESTART_REPLAY";

const runtimeState = {
  syncing: true,
  dataOk: false,
  gapDetected: false,
  syncSource: "BOOTSTRAP" as SyncSource,
  hasCompletedSync: false,
  syncEpoch: 0,
  lastSyncOkEpoch: 0,
};

function getRuntimeStateSnapshot() {
  return {
    syncing: runtimeState.syncing,
    dataOk: runtimeState.dataOk,
    gapDetected: runtimeState.gapDetected,
    syncSource: runtimeState.syncSource,
    hasCompletedSync: runtimeState.hasCompletedSync,
    syncEpoch: runtimeState.syncEpoch,
    lastSyncOkEpoch: runtimeState.lastSyncOkEpoch,
  };
}

function logSendOpenBlockState(tag: "[SEND_OPEN_BLOCK_ACTIVE]" | "[SEND_OPEN_BLOCK_CLEARED]") {
  const snapshot = getRuntimeStateSnapshot();

  log(tag, {
    blocked: isSendOpenBlocked(snapshot),
    reason: getSendOpenBlockReason(snapshot),
    ...snapshot,
  });
}

function setRuntimeSyncing(
  source: Exclude<SyncSource, "NONE">,
  options?: { gapDetected?: boolean }
) {
  runtimeState.syncEpoch += 1;
  runtimeState.syncing = true;
  runtimeState.dataOk = false;
  runtimeState.gapDetected = Boolean(options?.gapDetected);
  runtimeState.syncSource = source;

  log("[SYNCING]", getRuntimeStateSnapshot());
  logSendOpenBlockState("[SEND_OPEN_BLOCK_ACTIVE]");
}

function setRuntimeSyncOk() {
  runtimeState.syncing = false;
  runtimeState.dataOk = true;
  runtimeState.gapDetected = false;
  runtimeState.syncSource = "NONE";
  runtimeState.hasCompletedSync = true;
  runtimeState.lastSyncOkEpoch = runtimeState.syncEpoch;

  log("[SYNC_OK]", getRuntimeStateSnapshot());
  logSendOpenBlockState("[SEND_OPEN_BLOCK_CLEARED]");
}

const WS_RECONNECT_DELAY_MS = Number(process.env.WS_RECONNECT_DELAY_MS || 3000);

const TEST_FORCE_WS_CLOSE_ONCE =
  String(process.env.TEST_FORCE_WS_CLOSE_ONCE || "").toLowerCase() === "true";

const TEST_FORCE_WS_CLOSE_AFTER_MS = Number(
  process.env.TEST_FORCE_WS_CLOSE_AFTER_MS || 15000
);

const lastClosedBarCloseTime = new Map<string, number>();

const pendingReplayBars = new Map<string, Bar[]>();
const inFlightGapFetches = new Set<string>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let hasForcedWsClose = false;

function assertConfig() {
  if (D1_DAYKEY_TZ !== "UTC") {
    throw new Error(`D1_DAYKEY_TZ must be UTC, got=${D1_DAYKEY_TZ}`);
  }

  if (WATCHLIST.length === 0) {
    throw new Error("WATCHLIST is empty");
  }

  for (const tf of TF_SET) {
    const n = LOOKBACK[tf];
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid lookback for ${tf}: ${n}`);
    }
  }
}

function log(prefix: string, payload?: Record<string, unknown>) {
  if (!payload) {
    console.log(prefix);
    return;
  }
  console.log(`${prefix} ${JSON.stringify(payload)}`);
}

function streamName(symbol: string, interval: string): string {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

function intervalFromStream(stream: string): string | null {
  const token = "@kline_";
  const idx = stream.indexOf(token);
  if (idx === -1) return null;
  return stream.slice(idx + token.length);
}

function barKey(symbol: string, tf: TfKey): string {
  return `${symbol.toUpperCase()}:${tf}`;
}

function rememberClosedBar(symbol: string, tf: TfKey, closeTime: number) {
  lastClosedBarCloseTime.set(barKey(symbol, tf), closeTime);
}

function getLastClosedBarCloseTime(symbol: string, tf: TfKey): number | undefined {
  return lastClosedBarCloseTime.get(barKey(symbol, tf));
}

function isOldOrDuplicateBar(symbol: string, tf: TfKey, closeTime: number): boolean {
  const prev = lastClosedBarCloseTime.get(barKey(symbol, tf));
  return Number.isFinite(prev) && closeTime <= (prev as number);
}

function detectGap(symbol: string, tf: TfKey, closeTime: number): boolean {
  const prev = lastClosedBarCloseTime.get(barKey(symbol, tf));
  if (!Number.isFinite(prev)) return false;

  const expected = (prev as number) + tfDurationMs(tf);
  if (closeTime <= expected) return false;

  setRuntimeSyncing("GAP_REPLAY", { gapDetected: true });

  log("[GAP_DETECTED]", {
    symbol,
    tf,
    previousCloseTime: toIsoUtc(prev as number),
    expectedCloseTime: toIsoUtc(expected),
    actualCloseTime: toIsoUtc(closeTime),
  });

  return true;
}

function scheduleReconnect(reason: string) {
  if (reconnectTimer) return;

  log("[WS_RECONNECT_SCHEDULED]", {
    reason,
    delayMs: WS_RECONNECT_DELAY_MS,
  });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    log("[WS_RECONNECT_START]", { reason });
    startCombinedWs();
  }, WS_RECONNECT_DELAY_MS);
}

function makeBarFromKline(interval: string, k: NonNullable<WsCombinedKlineMessage["data"]>["k"]): Bar | null {
  if (!k) return null;

  const tf = intervalToTF(interval);
  if (!tf) return null;

  const open = Number(k.o);
  const high = Number(k.h);
  const low = Number(k.l);
  const close = Number(k.c);

  if (![open, high, low, close].every(Number.isFinite)) return null;

  return {
    tf,
    openTime: k.t,
    closeTime: k.T ?? k.t + tfDurationMs(tf),
    open,
    high,
    low,
    close,
  };
}

async function fetchClosedBarsRest(args: {
  symbol: string;
  tf: TfKey;
  limit?: number;
  startTime?: number;
  endTime?: number;
}): Promise<Bar[]> {
  const { symbol, tf, limit, startTime, endTime } = args;
  const interval = TF_TO_BINANCE[tf];

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
  });

  if (Number.isFinite(limit)) {
    params.set("limit", String(limit));
  }
  if (Number.isFinite(startTime)) {
    params.set("startTime", String(startTime));
  }
  if (Number.isFinite(endTime)) {
    params.set("endTime", String(endTime));
  }

  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params.toString()}`);
  if (!res.ok) {
    throw new Error(
      `fetchClosedBarsRest failed: symbol=${symbol} tf=${tf} status=${res.status}`
    );
  }

  const rows = (await res.json()) as Array<
    [number, string, string, string, string, string, number, ...unknown[]]
  >;

  const now = Date.now();

  return rows
    .map((r) =>
      makeBarFromKline(interval, {
        s: symbol.toUpperCase(),
        t: r[0],
        T: r[6],
        o: r[1],
        h: r[2],
        l: r[3],
        c: r[4],
        x: true,
      })
    )
    .filter((bar): bar is Bar => !!bar)
    .filter((bar) => bar.closeTime <= now);
}

async function fetchGapBars(
  symbol: string,
  tf: TfKey,
  previousCloseTime: number,
  actualCloseTime: number
): Promise<void> {
  const key = barKey(symbol, tf);
  if (inFlightGapFetches.has(key)) {
    return;
  }

  inFlightGapFetches.add(key);

  try {
    const bars = await fetchClosedBarsRest({
      symbol,
      tf,
      startTime: previousCloseTime + 1,
      endTime: actualCloseTime,
    });

    const replayBars = bars.filter(
      (bar) => bar.closeTime > previousCloseTime && bar.closeTime <= actualCloseTime
    );

    pendingReplayBars.set(key, replayBars);

    log("[GAP_FETCHED]", {
      symbol,
      tf,
      count: replayBars.length,
      firstCloseTime: replayBars.length ? toIsoUtc(replayBars[0].closeTime) : null,
      lastCloseTime: replayBars.length
        ? toIsoUtc(replayBars[replayBars.length - 1].closeTime)
        : null,
      includesCurrentBar: replayBars.some((bar) => bar.closeTime === actualCloseTime),
    });
  } catch (err) {
    log("[GAP_FETCH_ERROR]", {
      symbol,
      tf,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlightGapFetches.delete(key);
    drainPendingReplayBarsIfReady();
  }
}

const TF_REPLAY_ORDER: Record<TfKey, number> = {
  D1: 0,
  H4: 1,
  H1: 2,
  M30: 3,
  M15: 4,
  M5: 5,
};

type ReplayItem = {
  symbol: string;
  bar: Bar;
};

function compareReplayItems(a: ReplayItem, b: ReplayItem): number {
  if (a.bar.closeTime !== b.bar.closeTime) {
    return a.bar.closeTime - b.bar.closeTime;
  }

  if (a.symbol !== b.symbol) {
    return a.symbol.localeCompare(b.symbol);
  }

  return TF_REPLAY_ORDER[a.bar.tf as TfKey] - TF_REPLAY_ORDER[b.bar.tf as TfKey];
}

function buildReplayDigest(items: ReplayItem[]): string {
  const payload = items
    .map(({ symbol, bar }) =>
      [
        symbol,
        bar.tf,
        bar.openTime,
        bar.closeTime,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
      ].join("|")
    )
    .join("\n");

  return createHash("sha1").update(payload).digest("hex");
}

function injectBarsDeterministically(
  items: ReplayItem[],
  source: "bootstrap" | "gap" | "restart"
) {
  const sorted = [...items].sort(compareReplayItems);
  const digest = buildReplayDigest(sorted);

  log("[REPLAY_APPLY_START]", {
    source,
    count: sorted.length,
    digest,
  });

  for (const item of sorted) {
    const symbol = item.symbol.toUpperCase();
    const tf = item.bar.tf as TfKey;

    if (isOldOrDuplicateBar(symbol, tf, item.bar.closeTime)) {
      continue;
    }

    const engine = getOrInitEngine(symbol);
    const evs = engine.onBarClose(item.bar);

    rememberClosedBar(symbol, tf, item.bar.closeTime);

    if (evs.length) {
      console.log(evs.join("\n"));
    }
  }

  log("[REPLAY_APPLY_DONE]", {
    source,
    count: sorted.length,
    digest,
  });
}

function drainPendingReplayBarsIfReady() {
  if (inFlightGapFetches.size > 0) {
    return;
  }

  const items: ReplayItem[] = [];

  for (const [key, bars] of pendingReplayBars.entries()) {
    const symbol = key.split(":")[0]?.toUpperCase();
    if (!symbol) continue;

    for (const bar of bars) {
      items.push({ symbol, bar });
    }
  }

  pendingReplayBars.clear();

  injectBarsDeterministically(items, "gap");
  setRuntimeSyncOk();
}

async function bootstrapHistory() {
  setRuntimeSyncing("BOOTSTRAP");

  const collected: ReplayItem[] = [];

  for (const symbol of WATCHLIST) {
    for (const tf of TF_SET) {
      const interval = TF_TO_BINANCE[tf];
      const limit = LOOKBACK[tf];

      const bars = await fetchClosedBarsRest({ symbol, tf, limit });
      log("[BOOTSTRAP_FETCH]", {
        symbol,
        tf,
        interval,
        count: bars.length,
      });

      for (const bar of bars) {
        collected.push({
          symbol: symbol.toUpperCase(),
          bar,
        });
      }
    }
  }

  injectBarsDeterministically(collected, "bootstrap");
  setRuntimeSyncOk();
}

function startCombinedWs() {
  const streams = WATCHLIST.flatMap((symbol) =>
    TF_SET.map((tf) => streamName(symbol, TF_TO_BINANCE[tf]))
  );

  const url = `wss://fstream.binance.com/stream?streams=${streams.join("/")}`;
  const ws = new WebSocket(url);

  ws.on("open", () => {
    log("[WORKER_WS_OPEN]", { streams: streams.length });

    if (TEST_FORCE_WS_CLOSE_ONCE && !hasForcedWsClose) {
      hasForcedWsClose = true;

      log("[TEST_FORCE_WS_CLOSE_SCHEDULED]", {
        afterMs: TEST_FORCE_WS_CLOSE_AFTER_MS,
      });

      setTimeout(() => {
        log("[TEST_FORCE_WS_CLOSE_FIRE]", {
          afterMs: TEST_FORCE_WS_CLOSE_AFTER_MS,
        });
        ws.close();
      }, TEST_FORCE_WS_CLOSE_AFTER_MS);
    }
  });

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString()) as WsCombinedKlineMessage;

      const interval = intervalFromStream(msg.stream);
      if (!interval) return;

      const k = msg.data?.k;
      if (!k?.x) return;

      const bar = makeBarFromKline(interval, k);
      if (!bar) return;

      const symbol = k.s.toUpperCase();
      const tf = bar.tf as TfKey;

      if (isOldOrDuplicateBar(symbol, tf, bar.closeTime)) {
        log("[BAR_IGNORED_DUPLICATE]", {
          symbol,
          tf,
          closeTime: toIsoUtc(bar.closeTime),
        });
        return;
      }

      const prevCloseTime = getLastClosedBarCloseTime(symbol, tf);

      if (detectGap(symbol, tf, bar.closeTime)) {
        if (Number.isFinite(prevCloseTime)) {
          void fetchGapBars(symbol, tf, prevCloseTime as number, bar.closeTime);
        }

        log("[BAR_BLOCKED_SYNCING]", {
          symbol,
          tf,
          closeTime: toIsoUtc(bar.closeTime),
        });
        return;
      }

      const engine = getOrInitEngine(symbol);
      const evs = engine.onBarClose(bar);
      rememberClosedBar(symbol, tf, bar.closeTime);

      log("[BAR_CLOSE]", {
        symbol,
        interval,
        closeTime: toIsoUtc(bar.closeTime),
      });

      if (evs.length) {
        console.log(evs.join("\n"));

        void appendSignalEvents({
          symbol,
          tf: String(bar.tf),
          eventTexts: evs,
        });
      }
    } catch (err) {
      log("[WORKER_WS_PARSE_ERROR]", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ws.on("error", (err) => {
    log("[WORKER_WS_ERROR]", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  ws.on("close", () => {
    log("[WORKER_WS_CLOSE]");
    scheduleReconnect("ws_close");
  });
}

async function main() {
  assertConfig();

  log("[WORKER_START]", {
    watchlist: WATCHLIST,
    tfSet: TF_SET,
    d1DayKeyTz: D1_DAYKEY_TZ,
  });

  log("[PRICE_BASIS_LOCK]", dumpPriceBasisLock());

  await preloadTickSizes(WATCHLIST);
  log("[TICKSIZE_READY]", {
    values: dumpTickSizeCache(),
  });

  await bootstrapHistory();
  startCombinedWs();
}

main().catch((err) => {
  console.error("[WORKER_FATAL]", err);
  process.exit(1);
});

