"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "../../lib/engine/types";
import { getOrInitEngine } from "../../lib/engine/runtime";
import {
  fromBinanceInterval,
  normalizeChartTimeframe,
  toBinanceInterval,
  tfToSeconds,
  type ChartTimeframe,
} from "@/lib/chart/timeframes";
import {
  notifyChartControllerUpdated,
  registerChartController,
  unregisterChartController,
  type ChartController,
  type ChartTradePlanLinesArgs,
} from "@/lib/alerts/chart-controller";
import { getAlertPoiHighlight } from "@/lib/alerts/poi-highlight";
import type { StoredSignalPoiHighlight } from "@/lib/alerts/types";
import {
  linePriceAt,
} from "@/lib/chart/h4-context";
import { computeNextH4Context, createEmptyH4Context } from "@/lib/chart/h4-state";

/* =========================
   Types
========================= */
type Candle = {
  time: UTCTimestamp; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

type Line2P = {
  t1: UTCTimestamp;
  p1: number;
  t2: UTCTimestamp;
  p2: number;
};

type ZoneKind = "OB" | "FVG";
type ZoneInvalidReason = "break" | "touches" | "fullfill" | "choch";

type Zone = {
  kind: ZoneKind;
  side: "bull" | "bear";
  top: number;
  bottom: number;

  startTime: UTCTimestamp;
  endTime?: UTCTimestamp;

  active: boolean;
  invalidReason?: ZoneInvalidReason;

  touchCount?: number;
};

type ChannelNoneWhy =
  | "mixed_or_range"
  | "anchor_fail"
  | "residual_sample_lt_5"
  | "insufficient_data"
  | "no_atr";

type TrendNoneWhy =
  | "mixed_or_range"
  | "anchor_fail"
  | "insufficient_data"
  | "no_atr";

type ChannelState = {
  mode: "up" | "down" | "none";
  base?: Line2P; // up: support, down: resistance
  offset?: number; // p95 residual (>0)
  breakCount: number; // consecutive valid breaches (4H)
  anchorStartTime?: UTCTimestamp; // base.t1
  why?: ChannelNoneWhy; // ??mode==="none"?????댁쑀
};

type TrendlineState = {
  mode: "up" | "down" | "none";
  line?: Line2P;
  breakCount: number;
  anchorStartTime?: UTCTimestamp;
  why?: "mixed_or_range" | "anchor_fail"; // ??異붽?
};



type H4Context = {
  channel: ChannelState;
  trend: TrendlineState;
  zones: Zone[];
  last4hTime?: UTCTimestamp;
};

type Props = { symbol: string; tf: string };
type WsCombinedStreamMsg = {
  stream: string;
  data: WsKlineMsg;
};

type WsKlineMsg = {
  e: "kline";
  k: {
  t: number; // open time ms
  T: number; // close time ms 
  o: string;
  h: string;
  l: string;
  c: string;
  x: boolean; // closed
};
};
type WsAggTradeMsg = {
  e: "aggTrade";
  p: string;
  T: number;
};

function chartTimeframeFromStream(
  stream: string
): ChartTimeframe | null {
  const token = "@kline_";
  const idx = stream.indexOf(token);
  if (idx === -1) return null;
  return fromBinanceInterval(stream.slice(idx + token.length));
}

/* =========================
   Global in-memory store (persists across TF changes)
========================= */
const H4_STORE: Map<string, H4Context> = (() => {
  // SSR ?덉쟾?μ튂: ?쒕쾭?먯꽌??洹몃깷 ??Map
  if (typeof window === "undefined") return new Map<string, H4Context>();

  // 釉뚮씪?곗?(dev)?먯꽌??window??遺숈뿬??HMR?먮룄 ?좎?
  const w = window as any;
  return w.__H4_STORE ?? (w.__H4_STORE = new Map<string, H4Context>());
})();


function getOrInitH4(symbol: string): H4Context {
  const prev = H4_STORE.get(symbol);
  if (prev) return prev;
  const init = createEmptyH4Context() as unknown as H4Context;
  H4_STORE.set(symbol, init);
  return init;
}

function setH4(symbol: string, ctx: H4Context) {
  H4_STORE.set(symbol, ctx);
}

/* =========================
   Small utils
========================= */
function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function coordTimeToSec(t: any): UTCTimestamp | null {
  if (typeof t === "number") return Math.floor(t) as UTCTimestamp;
  if (t && typeof t === "object" && "year" in t) {
    const d = new Date(t.year, t.month - 1, t.day);
    return Math.floor(d.getTime() / 1000) as UTCTimestamp;
  }
  return null;
}

const SEC_4H = tfToSeconds("4h");
function to4hCloseTime(t: UTCTimestamp): UTCTimestamp {
  return (Number(t) + SEC_4H) as UTCTimestamp;
}

function percentile95Positive(values: number[]): number | null {
  const arr = values.filter((v) => Number.isFinite(v) && v > 0);
  if (arr.length < 5) return null;
  arr.sort((a, b) => a - b);
  const idx = Math.floor((arr.length - 1) * 0.95);
  return arr[idx];
}

function channelBoundaryPriceAt(ch: ChannelState, t: UTCTimestamp, which: "lower" | "upper") {
  // up: base=lower, upper=base+offset
  // down: base=upper, lower=base-offset
  const baseP = linePriceAt(ch.base!, t);
  if (ch.mode === "up") {
    return which === "lower" ? baseP : baseP + (ch.offset ?? 0);
  }
  // down
  return which === "upper" ? baseP : baseP - (ch.offset ?? 0);
}

function isNear(value: number, target: number, tol: number) {
  return Math.abs(value - target) <= tol;
}
// =====================
// Debug HUD (CH/TR/Z)
// =====================
const DEBUG_HUD = true;

function getH4FromWindow(symbol: string) {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const store = w.__H4_STORE as Map<string, any> | undefined;
  if (!store || typeof store.get !== "function") return null;
  return store.get(symbol) ?? null;
}

function drawDebugHUD(ctx: CanvasRenderingContext2D, symbol: string) {
  if (!ctx) return;

  const h4 = getH4FromWindow(symbol);
  const ch = h4?.channel;
  const tr = h4?.trend;
  const zones = Array.isArray(h4?.zones) ? h4.zones : [];

  const zActive = zones.filter((z: any) => !!z?.active).length;

  const chWhy = ch?.mode === "none" ? (ch?.why ?? "") : "";
  const trWhy = tr?.mode === "none" ? (tr?.why ?? "") : "";

  const lines: string[] = [
    `CH: ${ch?.mode ?? "?"}${chWhy ? ` (${chWhy})` : ""}  off=${Number.isFinite(ch?.offset) ? ch.offset.toFixed(1) : "??"}`,
    `TR: ${tr?.mode ?? "?"}${trWhy ? ` (${trWhy})` : ""}`,
    `Z: active ${zActive} / all ${zones.length}`,
  ];

  const w = window as any;
  if (w?.__CH_DBG?.stage) lines.push(`__CH_DBG: ${w.__CH_DBG.stage}${w.__CH_DBG.why ? ` (${w.__CH_DBG.why})` : ""}`);
  if (w?.__TR_DBG?.stage) lines.push(`__TR_DBG: ${w.__TR_DBG.stage}${w.__TR_DBG.why ? ` (${w.__TR_DBG.why})` : ""}`);
  if (w?.__Z_DBG?.stage)  lines.push(`__Z_DBG: ${w.__Z_DBG.stage}`);

  ctx.save();
  ctx.font = "12px monospace";
  ctx.textBaseline = "top";

  const pad = 6;
  const lineH = 14;
  const x = 8, y = 8;

  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const height = lines.length * lineH + pad * 2;

  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, width, height);

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH));

  ctx.restore();
}

/* =========================`n   Binance fetch (pagination)`n========================= */
const BINANCE_KLINES_MAX_LIMIT = 1500;
const MAX_CANDLES_IN_MEMORY = 3000;

async function fetchBinanceKlinesPage(params: {
  symbol: string;
  interval: string;
  limit?: number;
  endTimeMs?: number;
}): Promise<Candle[]> {
  const { symbol, interval, limit = 500, endTimeMs } = params;
  const safeLimit = Math.min(Math.max(1, limit), BINANCE_KLINES_MAX_LIMIT);

  const qs = new URLSearchParams({
    symbol,
    interval,
    limit: String(safeLimit),
  });
  if (endTimeMs != null) qs.set("endTime", String(endTimeMs));

  const url = `https://fapi.binance.com/fapi/v1/klines?${qs.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Binance API error: ${res.status} ${text}`);
  }

  const raw = (await res.json()) as any[];
  const candles: Candle[] = raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000) as UTCTimestamp,
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));

  candles.sort((a, b) => Number(a.time) - Number(b.time));
  return candles;
}

async function fetchBinanceKlinesPaginated(params: {
  symbol: string;
  interval: string;
  targetCount: number;
  pageLimit?: number;
  maxPages?: number;
}): Promise<Candle[]> {
  const { symbol, interval, targetCount, pageLimit = BINANCE_KLINES_MAX_LIMIT, maxPages = 10 } =
    params;

  const pageSize = Math.min(pageLimit, BINANCE_KLINES_MAX_LIMIT);
  let endTimeMs: number | undefined = Date.now();

  const byTime = new Map<number, Candle>();

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchBinanceKlinesPage({
      symbol,
      interval,
      limit: pageSize,
      endTimeMs,
    });
// D) ?ㅼ쓬 ?섏씠吏(??怨쇨굅)濡??대룞?섍린 ?꾪빐 endTimeMs 媛깆떊
if (!batch || batch.length === 0) break;

// Binance klines??蹂댄넻 ?쒓컙 ?ㅻ쫫李⑥닚?쇰줈 ?ㅻ?濡?batch[0]??"媛??怨쇨굅" 罹붾뱾
endTimeMs = Number(batch[0].time) * 1000 - 1;
if (byTime.size >= targetCount) break;

    if (batch.length === 0) break;

    for (const c of batch) byTime.set(Number(c.time), c);

    const oldest = batch[0];
    const nextEndMs = Number(oldest.time) * 1000 - 1;

    if (endTimeMs != null && nextEndMs >= endTimeMs) break;
    endTimeMs = nextEndMs;
  }

  const merged = Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
return merged.slice(Math.max(0, merged.length - targetCount));

}

async function fetchMoreHistory(params: {
  symbol: string;
  interval: string;
  alreadyHave: Candle[];
  addCount: number;
  pageLimit?: number;
  maxPages?: number;
}): Promise<Candle[]> {
  const { symbol, interval, alreadyHave, addCount, pageLimit = BINANCE_KLINES_MAX_LIMIT, maxPages = 10 } =
    params;

  const oldest = alreadyHave[0];
  if (!oldest) return alreadyHave;

  let endTimeMs: number | undefined = Number(oldest.time) * 1000 - 1;

  const byTime = new Map<number, Candle>();
  for (const c of alreadyHave) byTime.set(Number(c.time), c);

  let fetchedNew = 0;

  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchBinanceKlinesPage({
      symbol,
      interval,
      limit: Math.min(pageLimit, BINANCE_KLINES_MAX_LIMIT),
      endTimeMs,
    });

    if (batch.length === 0) break;

    for (const c of batch) {
      const key = Number(c.time);
      if (!byTime.has(key)) fetchedNew++;
      byTime.set(key, c);
    }

    if (fetchedNew >= addCount) break;

    const newOldest = batch[0];
    const nextEndMs = Number(newOldest.time) * 1000 - 1;

    if (endTimeMs != null && nextEndMs >= endTimeMs) break;
    endTimeMs = nextEndMs;
  }

  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

/* =========================
   Component
========================= */
export default function CandleChart({ symbol, tf }: Props) {
  const normalizedTf = useMemo<ChartTimeframe>(() => {
    return normalizeChartTimeframe(tf);
  }, [tf]);
  const interval = useMemo(() => toBinanceInterval(normalizedTf), [normalizedTf]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRafRef = useRef<number | null>(null);

  const rightScaleWRef = useRef(0);

  // LTF candles
  const candlesRef = useRef<Candle[]>([]);
  // 4H candles
  const candles4hRef = useRef<Candle[]>([]);

  // overlays from store
  const zonesRef = useRef<Zone[]>([]);
  const channelRef = useRef<ChannelState>({ mode: "none", breakCount: 0 });
  const trendRef = useRef<TrendlineState>({ mode: "none", breakCount: 0 });
  const planLinesRef = useRef<(ChartTradePlanLinesArgs & { expiresAt: number }) | null>(null);
  const planLinesTimeoutRef = useRef<number | null>(null);
  const highlightedPoiRef = useRef<(StoredSignalPoiHighlight & { expiresAt: number }) | null>(null);
  const highlightedPoiTimeoutRef = useRef<number | null>(null);

  const wsKlineRef = useRef<WebSocket | null>(null);
  const wsTradeRef = useRef<WebSocket | null>(null);
  const ws4hRef = useRef<WebSocket | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const lastAutoLoadAtRef = useRef(0);

  // ==== settings ====
  const MAX_FORWARD_BARS = 300;
  const BINANCE_PAGE_LIMIT = 1500;
const BINANCE_MAX_PAGES = 10;

const LTF_TARGET_CANDLES = 2000; // 珥덇린 濡쒕뱶
const LTF_MAX_CANDLES = 3000;    // 硫붾え由?理쒕?
const LTF_LOAD_MORE_STEP = 1500; // ??遺덈윭?ㅺ린 1??理쒕?移?

  const TRENDLINE_STROKE = "rgba(59,130,246,0.90)";
  const SHOW_INACTIVE_ZONES = true;
  const SHOW_INACTIVE_LABELS = false;

  const updateRightScaleW = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const w = chart.priceScale("right").width();
    if (Number.isFinite(w) && w > 0) rightScaleWRef.current = w;
  }, []);

  function syncFromStore() {
    const ctx = getOrInitH4(symbol);
    zonesRef.current = ctx.zones;
    channelRef.current = ctx.channel;
    trendRef.current = ctx.trend;
  }

  const goToTime = useCallback((centerTime: string, barsAround: number) => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length === 0) {
      return;
    }

    const centerSec = Math.floor(Date.parse(centerTime) / 1000);
    if (!Number.isFinite(centerSec)) {
      return;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    candles.forEach((candle, index) => {
      const distance = Math.abs(Number(candle.time) - centerSec);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    chart.timeScale().setVisibleLogicalRange({
      from: nearestIndex - barsAround,
      to: nearestIndex + barsAround,
    });
  }, []);

  // ===== drawOverlay =====
  function drawDebugHUD(ctx: CanvasRenderingContext2D) {
  const g: any = window as any;

  const ch = g.__CH_DBG;
  const tr = g.__TR_DBG;
  const z  = g.__Z_DBG; // ?덉쑝硫??ъ슜(?놁쑝硫????섏샂)
  const ctxDbg = g.__CTX;


  const fmt = (label: string, o: any) => {
    if (!o) return `${label}: (no dbg)`;
    const stage = o.stage ?? "";
    const why = o.why ?? "";
    const detail = o.detail ?? "";
    const count = o.count != null ? ` | count=${o.count}` : "";
    return `${label}: ${stage}${why ? ` | ${why}` : ""}${detail ? ` | ${detail}` : ""}${count}`;
  };

  ctx.save();
  ctx.font = "12px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textBaseline = "top";

  let y = 8;
  ctx.fillText(fmt("CH", ch), 8, y); y += 14;
  ctx.fillText(fmt("TR", tr), 8, y); y += 14;
  if (ctxDbg) { ctx.fillText(`CTX: calls=${ctxDbg.calls} pass=${ctxDbg.pass} fail=${ctxDbg.fail}`, 8, y); y += 14; }
if (z) ctx.fillText(fmt("Z", z), 8, y); y += 14;
  ctx.restore();
} 


  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const chart = chartRef.current;
    const series0 = seriesRef.current;
    if (!canvas || !chart || !series0) return;

    const ctx0 = canvas.getContext("2d");
    if (!ctx0) return;

    const series: ISeriesApi<"Candlestick"> = series0;
    const ctx: CanvasRenderingContext2D = ctx0;

    updateRightScaleW();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const nextW = Math.floor(w * dpr);
    const nextH = Math.floor(h * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const clipW = Math.max(0, w - rightScaleWRef.current);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, clipW, h);
    ctx.clip();

    try {
      const timeScale = chart.timeScale();
      const plotRightEdge = clipW;

      const ltfLastTime = candlesRef.current.at(-1)?.time;
      const ltfFirstTime = candlesRef.current[0]?.time;

      const forwardSec = MAX_FORWARD_BARS * SEC_4H; // ??ALWAYS 4H 湲곗? (?ㅽ럺 怨좎젙)

      function clampTimeToLtf(t: UTCTimestamp): UTCTimestamp {
        let v = Number(t);
        if (ltfFirstTime != null) v = Math.max(v, Number(ltfFirstTime));
        if (ltfLastTime != null) v = Math.min(v, Number(ltfLastTime) + forwardSec);
        return v as UTCTimestamp;
      }

      function normX(a: number, b: number) {
        const left = Math.min(a, b);
        const right = Math.max(a, b);
        return { left, right };
      }

      function safeTimeToX(t: UTCTimestamp) {
        const x = timeScale.timeToCoordinate(t as any);
        return x == null ? null : x;
      }

      function safePriceToY(p: number) {
        const y = series.priceToCoordinate(p);
        return y == null ? null : y;
      }

      const tVisLeft = coordTimeToSec(timeScale.coordinateToTime(0));
      const tVisRight = coordTimeToSec(timeScale.coordinateToTime(plotRightEdge));

      // ========== 1) CHANNEL FILL (behind) ==========
      const ch = channelRef.current;

      if (ch.mode !== "none" && ch.base && ch.offset && ltfLastTime != null) {
        const base = ch.base;
        const off = ch.offset;

        const tStartRaw = Math.max(
          Number(ch.anchorStartTime ?? base.t1),
          Number(tVisLeft ?? base.t1)
        ) as UTCTimestamp;

        const tEndLimit = (Number(ltfLastTime) + forwardSec) as UTCTimestamp;
        const tEndRaw = Math.min(Number(tVisRight ?? ltfLastTime), Number(tEndLimit)) as UTCTimestamp;

        const tL = clampTimeToLtf(tStartRaw);
        const tR = clampTimeToLtf(tEndRaw);

        const xL0 = safeTimeToX(tL);
        const xR0 = safeTimeToX(tR);
        const xA = xL0 ?? 0;
        const xB = xR0 ?? plotRightEdge;
        const { left: xL, right: xR } = normX(xA, xB);

        if (xR - xL >= 2) {
          const baseLP = linePriceAt(base, tL);
          const baseRP = linePriceAt(base, tR);

          const parLP = ch.mode === "up" ? baseLP + off : baseLP - off;
          const parRP = ch.mode === "up" ? baseRP + off : baseRP - off;

          const midLP = ch.mode === "up" ? baseLP + off * 0.5 : baseLP - off * 0.5;
          const midRP = ch.mode === "up" ? baseRP + off * 0.5 : baseRP - off * 0.5;

          const yBaseL = safePriceToY(baseLP);
          const yBaseR = safePriceToY(baseRP);
          const yParL = safePriceToY(parLP);
          const yParR = safePriceToY(parRP);
          const yMidL = safePriceToY(midLP);
          const yMidR = safePriceToY(midRP);

          if (yBaseL != null && yBaseR != null && yParL != null && yParR != null) {
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(xL, yBaseL);
            ctx.lineTo(xR, yBaseR);
            ctx.lineTo(xR, yParR);
            ctx.lineTo(xL, yParL);
            ctx.closePath();
            ctx.fill();

            if (yMidL != null && yMidR != null) {
              ctx.strokeStyle = "rgba(255,255,255,0.18)";
              ctx.lineWidth = 1;
              ctx.setLineDash([6, 6]);
              ctx.beginPath();
              ctx.moveTo(xL, yMidL);
              ctx.lineTo(xR, yMidR);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
      }

      // ========== 2) Boxes ==========
      const zones = zonesRef.current ?? [];
      const inactiveAll = zones.filter((z) => !z.active);
      const inactive = inactiveAll.slice(Math.max(0, inactiveAll.length - 20)); // 鍮꾪솢??20媛쒕쭔
      const activeFVG = zones.filter((z) => z.active && z.kind === "FVG");
      const activeOB = zones.filter((z) => z.active && z.kind === "OB");

      function drawZone(z: Zone, style: "inactive" | "active") {
        const ltfFirst = candlesRef.current[0]?.time;

        const tStart = (ltfFirst != null
          ? (Math.max(Number(z.startTime), Number(ltfFirst)) as UTCTimestamp)
          : z.startTime) as UTCTimestamp;

        const x1 = safeTimeToX(tStart);
        if (x1 == null) return;

        let x2: number | null = null;

        if (style === "inactive") {
          if (!z.endTime) return;
          if (ltfFirst != null && Number(z.endTime) < Number(ltfFirst)) return;

          const tEnd = (ltfFirst != null
            ? (Math.max(Number(z.endTime), Number(ltfFirst)) as UTCTimestamp)
            : z.endTime) as UTCTimestamp;

          x2 = safeTimeToX(tEnd);
          if (x2 == null) return;
        } else {
          if (ltfLastTime != null) {
            const tLimit = (Number(ltfLastTime) + forwardSec) as UTCTimestamp;
            const tRight = tVisRight ?? tLimit;
            const tClamped = Math.min(Number(tRight), Number(tLimit)) as UTCTimestamp;
            x2 = safeTimeToX(tClamped);
          }
          if (x2 == null) x2 = plotRightEdge;
        }

        const left = Math.max(0, Math.min(x1, x2));
        const right = Math.min(plotRightEdge, Math.max(x1, x2));
        if (right - left < 1) return;

        const yTop = safePriceToY(z.top);
        const yBot = safePriceToY(z.bottom);
        if (yTop == null || yBot == null) return;

        const topPx = Math.min(yTop, yBot);
        const botPx = Math.max(yTop, yBot);
        if (botPx - topPx < 1) return;

        const isBull = z.side === "bull";
        const isOB = z.kind === "OB";

        if (style === "active") {
          ctx.fillStyle = isBull
            ? isOB
              ? "rgba(34,197,94,0.22)"
              : "rgba(34,197,94,0.14)"
            : isOB
            ? "rgba(239,68,68,0.22)"
            : "rgba(239,68,68,0.14)";

          ctx.strokeStyle = isBull
            ? isOB
              ? "rgba(34,197,94,0.85)"
              : "rgba(34,197,94,0.60)"
            : isOB
            ? "rgba(239,68,68,0.85)"
            : "rgba(239,68,68,0.60)";

          ctx.lineWidth = isOB ? 2.0 : 1.6;
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.00)";
          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = 1.0;
        }

        ctx.fillRect(left, topPx, right - left, botPx - topPx);
        ctx.strokeRect(left, topPx, right - left, botPx - topPx);

        // label
        ctx.font = "12px sans-serif";
        if (style === "active") {
          const tag = isOB ? "OB" : "FVG";
          const padX = 6;
          const padY = 4;
          const textW = ctx.measureText(tag).width;

          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(left + 6, topPx + 6, textW + padX * 2, 16 + padY);

          ctx.fillStyle = isBull ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)";
          ctx.fillText(tag, left + 6 + padX, topPx + 6 + 14);
        } else {
          if (SHOW_INACTIVE_LABELS) {
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            const reason = z.invalidReason ? ` (${z.invalidReason})` : "";
            ctx.fillText(`INVALID${reason}`, left + 8, topPx + 16);
          }
        }
      }

      if (SHOW_INACTIVE_ZONES) {
        for (const z of inactive) drawZone(z, "inactive");
      }
      for (const z of activeFVG) drawZone(z, "active");
      for (const z of activeOB) drawZone(z, "active");

      // ========== 3) Lines (topmost): channel lines + trendline ==========
      // Channel lines
      if (ch.mode !== "none" && ch.base && ch.offset && ltfLastTime != null) {
        const base = ch.base;
        const off = ch.offset;

        const tStartRaw = Math.max(
          Number(ch.anchorStartTime ?? base.t1),
          Number(tVisLeft ?? base.t1)
        ) as UTCTimestamp;

        const tEndLimit = (Number(ltfLastTime) + forwardSec) as UTCTimestamp;
        const tEndRaw = Math.min(Number(tVisRight ?? ltfLastTime), Number(tEndLimit)) as UTCTimestamp;

        const tL = clampTimeToLtf(tStartRaw);
        const tR = clampTimeToLtf(tEndRaw);

        const xL0 = safeTimeToX(tL);
        const xR0 = safeTimeToX(tR);
        const xA = xL0 ?? 0;
        const xB = xR0 ?? plotRightEdge;
        const { left: xL, right: xR } = normX(xA, xB);

        if (xR - xL >= 2) {
          const baseLP = linePriceAt(base, tL);
          const baseRP = linePriceAt(base, tR);

          const parLP = ch.mode === "up" ? baseLP + off : baseLP - off;
          const parRP = ch.mode === "up" ? baseRP + off : baseRP - off;

          const yBaseL = safePriceToY(baseLP);
          const yBaseR = safePriceToY(baseRP);
          const yParL = safePriceToY(parLP);
          const yParR = safePriceToY(parRP);

          if (yBaseL != null && yBaseR != null && yParL != null && yParR != null) {
            ctx.strokeStyle = "rgba(255,255,255,0.70)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(xL, yBaseL);
            ctx.lineTo(xR, yBaseR);
            ctx.stroke();

            ctx.strokeStyle = "rgba(255,255,255,0.50)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(xL, yParL);
            ctx.lineTo(xR, yParR);
            ctx.stroke();

            ctx.font = "12px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            const yLabel = Math.min(yBaseL, yParL) - 6;
            ctx.fillText(ch.mode === "up" ? "CHANNEL (UP)" : "CHANNEL (DOWN)", xL + 8, Math.max(14, yLabel));
          }
        }
      }

      // Trendline
      const tr = trendRef.current;
      if (tr.mode !== "none" && tr.line && ltfLastTime != null) {
        const line = tr.line;

        const tStartRaw = Math.max(
          Number(tr.anchorStartTime ?? line.t1),
          Number(tVisLeft ?? line.t1)
        ) as UTCTimestamp;

        const tEndLimit = (Number(ltfLastTime) + forwardSec) as UTCTimestamp;
        const tEndRaw = Math.min(Number(tVisRight ?? ltfLastTime), Number(tEndLimit)) as UTCTimestamp;

        const tL = clampTimeToLtf(tStartRaw);
        const tR = clampTimeToLtf(tEndRaw);

        const xL0 = safeTimeToX(tL);
        const xR0 = safeTimeToX(tR);
        const xA = xL0 ?? 0;
        const xB = xR0 ?? plotRightEdge;
        const { left: xL, right: xR } = normX(xA, xB);

        if (xR - xL >= 2) {
          const pL = linePriceAt(line, tL);
          const pR = linePriceAt(line, tR);

          const yL = safePriceToY(pL);
          const yR = safePriceToY(pR);

          if (yL != null && yR != null) {
            ctx.strokeStyle = TRENDLINE_STROKE;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(xL, yL);
            ctx.lineTo(xR, yR);
            ctx.stroke();

            ctx.font = "12px sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.fillText(tr.mode === "up" ? "TREND (UP)" : "TREND (DOWN)", xL + 8, Math.max(14, yL - 6));
          }
        }
      }

      const planLines = planLinesRef.current;
      if (planLines) {
        if (Date.now() >= planLines.expiresAt) {
          planLinesRef.current = null;
        } else {
          const lines = [
            {
              price: planLines.entryRefPrice,
              label: "ENTRY",
              color: "rgba(59,130,246,0.95)",
            },
            {
              price: planLines.stopPrice,
              label: "STOP",
              color: "rgba(239,68,68,0.95)",
            },
            {
              price: planLines.tpPrice,
              label: "TP",
              color: "rgba(34,197,94,0.95)",
            },
          ];

          ctx.font = "12px sans-serif";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 6]);

          for (const line of lines) {
            const y = safePriceToY(line.price);
            if (y == null) {
              continue;
            }

            ctx.strokeStyle = line.color;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(plotRightEdge, y);
            ctx.stroke();

            const labelX = Math.max(8, plotRightEdge - 92);
            const labelY = Math.max(14, y - 8);
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(labelX - 6, labelY - 10, 82, 18);
            ctx.fillStyle = line.color;
            ctx.fillText(`${line.label} ${line.price.toFixed(4)}`, labelX, labelY + 2);
          }

          ctx.setLineDash([]);
        }
      }

      const highlightedPoi = highlightedPoiRef.current;
      if (highlightedPoi) {
        if (Date.now() >= highlightedPoi.expiresAt) {
          highlightedPoiRef.current = null;
        } else if (highlightedPoi.kind === "TRENDLINE") {
          const tL = clampTimeToLtf(
            (tVisLeft ?? highlightedPoi.line.t1) as UTCTimestamp
          );
          const tR = clampTimeToLtf(
            (tVisRight ?? highlightedPoi.line.t2) as UTCTimestamp
          );
          const xL = safeTimeToX(tL) ?? 0;
          const xR = safeTimeToX(tR) ?? plotRightEdge;
          const pL = linePriceAt(highlightedPoi.line, tL);
          const pR = linePriceAt(highlightedPoi.line, tR);
          const yL = safePriceToY(pL);
          const yR = safePriceToY(pR);

          if (yL != null && yR != null) {
            ctx.save();
            ctx.strokeStyle = "rgba(250,204,21,0.98)";
            ctx.shadowColor = "rgba(250,204,21,0.55)";
            ctx.shadowBlur = 10;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(xL, yL);
            ctx.lineTo(xR, yR);
            ctx.stroke();
            ctx.restore();
          }
        } else if (highlightedPoi.kind === "CHANNEL") {
          const tL = clampTimeToLtf(
            (tVisLeft ?? highlightedPoi.base.t1) as UTCTimestamp
          );
          const tR = clampTimeToLtf(
            (tVisRight ?? highlightedPoi.base.t2) as UTCTimestamp
          );
          const xL = safeTimeToX(tL) ?? 0;
          const xR = safeTimeToX(tR) ?? plotRightEdge;
          const baseLP = linePriceAt(highlightedPoi.base, tL);
          const baseRP = linePriceAt(highlightedPoi.base, tR);
          const parLP =
            highlightedPoi.mode === "up"
              ? baseLP + highlightedPoi.offset
              : baseLP - highlightedPoi.offset;
          const parRP =
            highlightedPoi.mode === "up"
              ? baseRP + highlightedPoi.offset
              : baseRP - highlightedPoi.offset;
          const yBaseL = safePriceToY(baseLP);
          const yBaseR = safePriceToY(baseRP);
          const yParL = safePriceToY(parLP);
          const yParR = safePriceToY(parRP);

          if (
            yBaseL != null &&
            yBaseR != null &&
            yParL != null &&
            yParR != null
          ) {
            ctx.save();
            ctx.fillStyle = "rgba(250,204,21,0.10)";
            ctx.beginPath();
            ctx.moveTo(xL, yBaseL);
            ctx.lineTo(xR, yBaseR);
            ctx.lineTo(xR, yParR);
            ctx.lineTo(xL, yParL);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = "rgba(250,204,21,0.98)";
            ctx.shadowColor = "rgba(250,204,21,0.45)";
            ctx.shadowBlur = 10;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(xL, yBaseL);
            ctx.lineTo(xR, yBaseR);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(xL, yParL);
            ctx.lineTo(xR, yParR);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    } finally {
      if (DEBUG_HUD) drawDebugHUD(ctx);
      ctx.restore();
    }
  }, [MAX_FORWARD_BARS, SHOW_INACTIVE_LABELS, SHOW_INACTIVE_ZONES, TRENDLINE_STROKE, normalizedTf, updateRightScaleW]);

  const scheduleDrawOverlay = useCallback(() => {
    if (overlayRafRef.current != null) return;
    overlayRafRef.current = window.requestAnimationFrame(() => {
      overlayRafRef.current = null;
      drawOverlay();
    });
  }, [drawOverlay]);

  const showTradePlanLines = useCallback((args: ChartTradePlanLinesArgs) => {
    planLinesRef.current = {
      ...args,
      expiresAt: Date.now() + args.durationMs,
    };

    if (planLinesTimeoutRef.current != null) {
      window.clearTimeout(planLinesTimeoutRef.current);
    }

    planLinesTimeoutRef.current = window.setTimeout(() => {
      planLinesRef.current = null;
      planLinesTimeoutRef.current = null;
      scheduleDrawOverlay();
    }, args.durationMs);

    scheduleDrawOverlay();
  }, [scheduleDrawOverlay]);

  const highlightPOI = useCallback((poiRef: string, durationMs: number) => {
    const poiHighlight = getAlertPoiHighlight(poiRef);
    if (!poiHighlight) {
      return false;
    }

    highlightedPoiRef.current = {
      ...poiHighlight,
      expiresAt: Date.now() + durationMs,
    };

    if (highlightedPoiTimeoutRef.current != null) {
      window.clearTimeout(highlightedPoiTimeoutRef.current);
    }

    highlightedPoiTimeoutRef.current = window.setTimeout(() => {
      highlightedPoiRef.current = null;
      highlightedPoiTimeoutRef.current = null;
      scheduleDrawOverlay();
    }, durationMs);

    scheduleDrawOverlay();
    return true;
  }, [scheduleDrawOverlay]);

  useEffect(() => {
    const controller: ChartController = {
      symbol,
      tf: normalizedTf,
      isReady: () => {
        return chartRef.current != null && seriesRef.current != null && candlesRef.current.length > 0;
      },
      goToTime,
      showTradePlanLines,
      highlightPOI,
    };

    registerChartController(controller);
    return () => {
      unregisterChartController(controller);
    };
  }, [goToTime, highlightPOI, normalizedTf, showTradePlanLines, symbol]);

  // ===== Load more (LTF only) =====
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMoreRef.current) return;

    try {
      isLoadingMoreRef.current = true;
      setIsLoadingMore(true);
      setError(null);

      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart) return;

      const current = candlesRef.current;
      if (!current.length) return;

      const prevLen = current.length;
      const need = Math.min(
  LTF_LOAD_MORE_STEP,
  Math.max(0, LTF_MAX_CANDLES - current.length)
);
if (need <= 0) return;


      const merged = await fetchMoreHistory({
        symbol,
        interval,
        alreadyHave: current,
        addCount: need,
        pageLimit: BINANCE_PAGE_LIMIT,
        maxPages: BINANCE_MAX_PAGES,
      });

      const beforeRange = chart.timeScale().getVisibleLogicalRange();

      series.setData(merged);
      candlesRef.current = merged;
      notifyChartControllerUpdated();

      const delta = merged.length - prevLen;
      if (beforeRange && delta > 0) {
        chart.timeScale().setVisibleLogicalRange({
          from: beforeRange.from + delta,
          to: beforeRange.to + delta,
        });
      }

      syncFromStore();
      updateRightScaleW();
      scheduleDrawOverlay();
    } catch (e: any) {
      setError(e?.message ?? "怨쇨굅 ?곗씠??濡쒕뱶 ?ㅽ뙣");
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [interval, scheduleDrawOverlay, symbol, updateRightScaleW]);

useEffect(() => {
  (window as any).__DBG_VERSION = "dbg_v1";
  (window as any).__CH_DBG = (window as any).__CH_DBG ?? { init: true };
  (window as any).__TR_DBG = (window as any).__TR_DBG ?? { init: true };
  (window as any).__H4_CTX = (window as any).__H4_CTX ?? { init: true };
}, []);

  // ===== AUTO LOAD =====
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const timeScale = chart.timeScale();
    const AUTO_LOAD_THRESHOLD = 20;
    const AUTO_LOAD_COOLDOWN_MS = 1200;

    const onVisibleLogicalRangeChange = (range: LogicalRange | null) => {
      if (!range) return;

      const len = candlesRef.current.length;
      if (len > 0 && range.from <= 0 && range.to >= len - 1 - 2) return;

      if (range.from <= AUTO_LOAD_THRESHOLD) {
        const now = Date.now();
        if (isLoadingMoreRef.current) return;
        if (now - lastAutoLoadAtRef.current < AUTO_LOAD_COOLDOWN_MS) return;

        lastAutoLoadAtRef.current = now;
        handleLoadMore();
      }

      scheduleDrawOverlay();
    };

    timeScale.subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChange);
    };
  }, [handleLoadMore, scheduleDrawOverlay]);

  // ===== Chart create (once) =====
  useEffect(() => {
    setError(null);
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height: 520,
      layout: { background: { color: "#09090b" }, textColor: "#e4e4e7" },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: {
        borderColor: "#27272a",
        rightOffset: 10,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: { mode: CrosshairMode.Magnet },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    notifyChartControllerUpdated();

    updateRightScaleW();

    const timeScale = chart.timeScale();

    const onVisibleTimeRange = () => {
      updateRightScaleW();
      scheduleDrawOverlay();
    };
    const onCrosshairMove = () => scheduleDrawOverlay();

    timeScale.subscribeVisibleTimeRangeChange(onVisibleTimeRange);
    chart.subscribeCrosshairMove(onCrosshairMove);

    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      const width = el.clientWidth;
      chart.applyOptions({ width });
      requestAnimationFrame(() => {
        updateRightScaleW();
        scheduleDrawOverlay();
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      timeScale.unsubscribeVisibleTimeRangeChange(onVisibleTimeRange);
      chart.unsubscribeCrosshairMove(onCrosshairMove);

      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [scheduleDrawOverlay, updateRightScaleW]);

  // ===== Initial load (LTF candles) =====
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError(null);

        const series = seriesRef.current;
        const chart = chartRef.current;
        if (!series || !chart) return;

        const TARGET_CANDLES = LTF_TARGET_CANDLES;
        const data = await fetchBinanceKlinesPaginated({
          symbol,
          interval,
          targetCount: TARGET_CANDLES,
          pageLimit: BINANCE_PAGE_LIMIT,
          maxPages: BINANCE_MAX_PAGES,
        });

        if (cancelled) return;

        series.setData(data);
        candlesRef.current = data;
        setLastPrice(data.at(-1)?.close ?? null);
        notifyChartControllerUpdated();

        chart.timeScale().fitContent();

        syncFromStore();
        updateRightScaleW();
        scheduleDrawOverlay();
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "?곗씠??濡쒕뱶 ?ㅽ뙣");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [interval, scheduleDrawOverlay, symbol, updateRightScaleW]);

  // ===== Initial load (4H context candles) =====
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data4h = await fetchBinanceKlinesPaginated({
          symbol,
          interval: "4h",
          targetCount: 1400,
          pageLimit: 1500,
          maxPages: 10,
        });
        if (cancelled) return;

        candles4hRef.current = data4h;

        const prev = getOrInitH4(symbol);
        const next = computeNextH4Context(
          prev as any,
          data4h as any
        ) as unknown as H4Context;

        setH4(symbol, next);
        syncFromStore();
        scheduleDrawOverlay();
      } catch (e: any) {
        setError((prevErr) => prevErr ?? `4H context load failed: ${e?.message ?? ""}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scheduleDrawOverlay, symbol]);

  // ===== WS (LTF) =====
  useEffect(() => {
    wsKlineRef.current?.close();
    wsTradeRef.current?.close();
    wsKlineRef.current = null;
    wsTradeRef.current = null;

    const series = seriesRef.current;
    if (!series) return;

    const symLower = symbol.toLowerCase();

    const wsKline = new WebSocket(`wss://fstream.binance.com/ws/${symLower}@kline_${interval}`);
    wsKlineRef.current = wsKline;

    wsKline.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsKlineMsg;
        if (msg.e !== "kline" || !msg.k) return;

        const c: Candle = {
          time: Math.floor(msg.k.t / 1000) as UTCTimestamp,
          open: Number(msg.k.o),
          high: Number(msg.k.h),
          low: Number(msg.k.l),
          close: Number(msg.k.c),
        };

        series.update(c);
        setLastPrice(c.close);

        const arr = candlesRef.current;
        const last = arr[arr.length - 1];

        if (!last || last.time < c.time) {
          arr.push(c);
          if (arr.length > MAX_CANDLES_IN_MEMORY) arr.shift();
        } else if (last.time === c.time) {
          arr[arr.length - 1] = c;
        }
        notifyChartControllerUpdated();
        
        syncFromStore();
        updateRightScaleW();
        scheduleDrawOverlay();
      } catch {
        // ignore
      }
    };

    const wsTrade = new WebSocket(`wss://fstream.binance.com/ws/${symLower}@aggTrade`);
    wsTradeRef.current = wsTrade;

    wsTrade.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsAggTradeMsg;
        if (msg.e !== "aggTrade") return;
        const p = Number(msg.p);
        if (!Number.isFinite(p)) return;
        setLastPrice(p);
        updateRightScaleW();
        scheduleDrawOverlay();
      } catch {
        // ignore
      }
    };

    wsKline.onerror = () => setError("kline websocket error");
    wsTrade.onerror = () => setError("trade websocket error");

    return () => {
      wsKline.close();
      wsTrade.close();
      wsKlineRef.current = null;
      wsTradeRef.current = null;
    };
  }, [interval, scheduleDrawOverlay, symbol, updateRightScaleW]);

  // ===== WS (4H always) =====
  useEffect(() => {
    ws4hRef.current?.close();
    ws4hRef.current = null;

    const symLower = symbol.toLowerCase();
    const ws4h = new WebSocket(`wss://fstream.binance.com/ws/${symLower}@kline_4h`);
    ws4hRef.current = ws4h;

    ws4h.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsKlineMsg;
        if (msg.e !== "kline" || !msg.k) return;

        const c: Candle = {
          time: Math.floor(msg.k.t / 1000) as UTCTimestamp,
          open: Number(msg.k.o),
          high: Number(msg.k.h),
          low: Number(msg.k.l),
          close: Number(msg.k.c),
        };

        const arr = candles4hRef.current;
        const last = arr[arr.length - 1];

        if (!last || last.time < c.time) {
          arr.push(c);
          if (arr.length > 2000) arr.shift();
        } else if (last.time === c.time) {
          arr[arr.length - 1] = c;
        }

        if (msg.k.x) {
          // only on 4H close
                   

          const prev = getOrInitH4(symbol);
          const next = computeNextH4Context(
            prev as any,
            arr as any
          ) as unknown as H4Context;

          setH4(symbol, next);
          syncFromStore();
        }

        scheduleDrawOverlay();
      } catch {
        // ignore
      }
    };

    ws4h.onerror = () => setError("4H websocket error");

    return () => {
      ws4h.close();
      ws4hRef.current = null;
    };
  }, [scheduleDrawOverlay, symbol]);


  // overlay rAF cleanup
  useEffect(() => {
    return () => {
      if (overlayRafRef.current != null) {
        cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      if (planLinesTimeoutRef.current != null) {
        window.clearTimeout(planLinesTimeoutRef.current);
        planLinesTimeoutRef.current = null;
      }
      if (highlightedPoiTimeoutRef.current != null) {
        window.clearTimeout(highlightedPoiTimeoutRef.current);
        highlightedPoiTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-[520px] w-full">
      <div ref={containerRef} className="h-[520px] w-full" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 z-20 h-[520px] w-full" />

      {error && (
        <div className="absolute left-3 top-3 rounded bg-red-500/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {lastPrice != null && (
        <div className="absolute right-3 top-3 rounded bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100">
          ?꾩옱媛: {lastPrice.toFixed(2)}
        </div>
      )}

      <div className="absolute left-3 bottom-16 z-50 pointer-events-auto">
        <button
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="rounded bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          {isLoadingMore ? "遺덈윭?ㅻ뒗 以?.." : "怨쇨굅 ??遺덈윭?ㅺ린"}
        </button>
      </div>
    </div>
  );
}


