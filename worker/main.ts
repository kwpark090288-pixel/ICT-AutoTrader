import "dotenv/config";
import WebSocket from "ws";

import { getOrInitEngine } from "../lib/engine/runtime";
import { intervalToTF, tfDurationMs } from "../lib/engine/binance";
import { toIsoUtc } from "../lib/engine/time";
import { dumpTickSizeCache, preloadTickSizes } from "../lib/engine/ticksize";
import { dumpPriceBasisLock } from "../lib/engine/price-basis";
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

const runtimeState = {
  syncing: true,
  dataOk: false,
  gapDetected: false,
};

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

async function fetchClosedKlines(symbol: string, interval: string, limit: number) {
  const url =
    `https://fapi.binance.com/fapi/v1/klines` +
    `?symbol=${symbol}` +
    `&interval=${interval}` +
    `&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetchClosedKlines failed: ${symbol} ${interval} ${res.status}`);
  }

  const rows = (await res.json()) as Array<
    [number, string, string, string, string, string, number, ...unknown[]]
  >;

  return rows.map((r) => ({
    s: symbol,
    t: r[0],
    T: r[6],
    o: r[1],
    h: r[2],
    l: r[3],
    c: r[4],
    x: true,
  }));
}

async function bootstrapHistory() {
  log("[SYNCING]", runtimeState);

  for (const symbol of WATCHLIST) {
    const engine = getOrInitEngine(symbol);

    for (const tf of TF_SET) {
      const interval = TF_TO_BINANCE[tf];
      const limit = LOOKBACK[tf];

      const klines = await fetchClosedKlines(symbol, interval, limit);
      log("[BOOTSTRAP_FETCH]", { symbol, tf, interval, count: klines.length });

      for (const k of klines) {
        const bar = makeBarFromKline(interval, k);
        if (!bar) continue;

        const evs = engine.onBarClose(bar);
        if (evs.length) {
          console.log(evs.join("\n"));
        }
      }
    }
  }

  runtimeState.syncing = false;
  runtimeState.dataOk = true;
  runtimeState.gapDetected = false;

  log("[SYNC_OK]", runtimeState);
}

function startCombinedWs() {
  const streams = WATCHLIST.flatMap((symbol) =>
    TF_SET.map((tf) => streamName(symbol, TF_TO_BINANCE[tf]))
  );

  const url = `wss://fstream.binance.com/stream?streams=${streams.join("/")}`;
  const ws = new WebSocket(url);

  ws.on("open", () => {
    log("[WORKER_WS_OPEN]", { streams: streams.length });
  });

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString()) as WsCombinedKlineMessage;

      const interval = intervalFromStream(msg.stream);
      if (!interval) return;

      const k = msg.data?.k;
      if (!k?.x) return; // DAY1-12/17: close-confirmed only

      const bar = makeBarFromKline(interval, k);
      if (!bar) return;

      const engine = getOrInitEngine(k.s);
      const evs = engine.onBarClose(bar);

      log("[BAR_CLOSE]", {
        symbol: k.s,
        interval,
        closeTime: toIsoUtc(bar.closeTime),
      });

      if (evs.length) {
        console.log(evs.join("\n"));
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
    // reconnect/gap handling is DAY2 scope
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
