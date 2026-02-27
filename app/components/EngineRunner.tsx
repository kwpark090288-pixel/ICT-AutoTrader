"use client";

import { useEffect } from "react";
import type { Bar } from "../../lib/engine/types";
import { intervalToTF, tfDurationMs } from "../../lib/engine/binance";
import { getOrInitEngine } from "../../lib/engine/runtime";

type WsKlineMsg = {
  e: "kline";
  k: {
    t: number; // open time ms
    T?: number; // close time ms (binance sometimes optional in typings)
    o: string;
    h: string;
    l: string;
    c: string;
    x: boolean; // closed
  };
};

type WsCombinedStreamMsg = {
  stream: string;
  data: WsKlineMsg;
};

function klineIntervalFromStream(stream: string): string | null {
  const token = "@kline_";
  const idx = stream.indexOf(token);
  if (idx === -1) return null;
  return stream.slice(idx + token.length); // "15m" | "4h" | "1d" ...
}

export default function EngineRunner(props: { symbol: string }) {
  const { symbol } = props;

  useEffect(() => {
    const sym = symbol.toLowerCase();
    const intervals = ["1d", "4h", "1h", "30m", "15m", "5m"]; // 엔진 스펙 TF 고정
    const streams = intervals.map((iv) => `${sym}@kline_${iv}`).join("/");
    const url = `wss://fstream.binance.com/stream?streams=${streams}`;

    const ws = new WebSocket(url);
    const engine = getOrInitEngine(symbol);

    ws.onopen = () => {
      console.log("[ENGINE_WS] open", url);
    };

    ws.onerror = (err) => {
      console.error("[ENGINE_WS] error", err);
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as WsCombinedStreamMsg;

      const interval = klineIntervalFromStream(msg.stream);
      if (!interval) return;

      const tfEnum = intervalToTF(interval);
      if (!tfEnum) return;

      const k = msg.data?.k;
      if (!k?.x) return; // ✅ 마감봉에서만 onBarClose

      const openP = Number(k.o);
      const highP = Number(k.h);
      const lowP = Number(k.l);
      const closeP = Number(k.c);
      if (![openP, highP, lowP, closeP].every(Number.isFinite)) return;

      const openMs = k.t;
      const closeMs = k.T ?? openMs + tfDurationMs(tfEnum);

      const bar: Bar = {
        tf: tfEnum,
        openTime: openMs,
        closeTime: closeMs,
        open: openP,
        high: highP,
        low: lowP,
        close: closeP,
      };

      const evs = engine.onBarClose(bar);
      if (evs.length) console.log(evs.join("\n"));
    };

    ws.onclose = () => {
      console.log("[ENGINE_WS] close");
    };

    return () => {
      ws.close();
    };
  }, [symbol]);

  return null; // ✅ UI 없음(러너)
}
