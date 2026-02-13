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
import { intervalToTF, tfDurationMs } from "../../lib/engine/binance";
import { getOrInitEngine } from "../../lib/engine/runtime";

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
  why?: ChannelNoneWhy; // ✅ mode==="none"일 때 이유
};

type TrendlineState = {
  mode: "up" | "down" | "none";
  line?: Line2P;
  breakCount: number;
  anchorStartTime?: UTCTimestamp;
  why?: "mixed_or_range" | "anchor_fail"; // ✅ 추가
};



type H4Context = {
  channel: ChannelState;
  trend: TrendlineState;
  zones: Zone[];
  last4hTime?: UTCTimestamp;
};

type Props = { symbol: string; tf: string };

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

/* =========================
   Global in-memory store (persists across TF changes)
========================= */
const H4_STORE: Map<string, H4Context> = (() => {
  // SSR 안전장치: 서버에서는 그냥 새 Map
  if (typeof window === "undefined") return new Map<string, H4Context>();

  // 브라우저(dev)에서는 window에 붙여서 HMR에도 유지
  const w = window as any;
  return w.__H4_STORE ?? (w.__H4_STORE = new Map<string, H4Context>());
})();


function getOrInitH4(symbol: string): H4Context {
  const prev = H4_STORE.get(symbol);
  if (prev) return prev;
  const init: H4Context = {
    channel: { mode: "none", breakCount: 0 },
    trend: { mode: "none", breakCount: 0 },
    zones: [],
    last4hTime: undefined,
  };
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

function tfToSeconds(tf: string): number {
  const t = tf.toLowerCase();
  if (t === "3m") return 3 * 60;
  if (t === "5m") return 5 * 60;
  if (t === "15m") return 15 * 60;
  if (t === "30m") return 30 * 60;
  if (t === "1h") return 60 * 60;
  if (t === "2h") return 2 * 60 * 60;
  if (t === "4h") return 4 * 60 * 60;
  return 15 * 60;
}

const SEC_4H = tfToSeconds("4H");
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
    `CH: ${ch?.mode ?? "?"}${chWhy ? ` (${chWhy})` : ""}  off=${Number.isFinite(ch?.offset) ? ch.offset.toFixed(1) : "—"}`,
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

const CONTEXT_ATR_MULT = 0.25;

function passesContextDistance(
  side: "bull" | "bear",
  midPrice: number,
  t: UTCTimestamp,

  atrNow: number,
  channel: ChannelState,
  trend: TrendlineState,

  // ✅ zone 상/하단(있으면 range 기준으로 dist 계산)
  zoneTop?: number,
  zoneBottom?: number
) {
  const distMax = atrNow * CONTEXT_ATR_MULT;

  // ✅ zone range(없으면 midPrice를 1점 range로 취급)
  const hasZone =
    Number.isFinite(zoneTop ?? NaN) && Number.isFinite(zoneBottom ?? NaN);
  const lo = hasZone ? Math.min(zoneTop as number, zoneBottom as number) : midPrice;
  const hi = hasZone ? Math.max(zoneTop as number, zoneBottom as number) : midPrice;

  // ✅ ref가 [lo, hi] 안이면 dist=0
  const distToRange = (ref: number) => {
    if (ref < lo) return lo - ref;
    if (ref > hi) return ref - hi;
    return 0;
  };

  const g: any = window as any;
  if (!g.__CTX) g.__CTX = { calls: 0, pass: 0, fail: 0, reasons: {}, last: null };
  const ctx = g.__CTX;

  const mark = (ok: boolean, why: string, detail: any = {}) => {
    const g: any = window as any;
    const ctx = g.__CTX;
    if (!ctx) return;

    ctx.calls = (ctx.calls ?? 0) + 1;
    if (ok) ctx.pass = (ctx.pass ?? 0) + 1;
    else ctx.fail = (ctx.fail ?? 0) + 1;

    ctx.reasons = ctx.reasons ?? {};
    ctx.reasons[why] = (ctx.reasons[why] ?? 0) + 1;

    ctx.last = { ok, why, ...detail };
  };

  // 1) 채널 있으면 채널 우선 + 방향 일치 강제
  // ✅ base만 있어도 사용(upper/lower가 base로 계산되도록)
  if (channel.mode !== "none" && channel.base) {
    if (channel.mode === "up") {
      if (side !== "bull") {
        mark(false, "ch_dir_mismatch", { side, chMode: channel.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = channelBoundaryPriceAt(channel, t, "lower"); // up 채널 lower = base
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "ch_ok_lower" : "ch_too_far", {
        ref, dist, distMax, midPrice, lo, hi, side, chMode: channel.mode
      });
      return ok;
    }

    if (channel.mode === "down") {
      if (side !== "bear") {
        mark(false, "ch_dir_mismatch", { side, chMode: channel.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = channelBoundaryPriceAt(channel, t, "upper"); // down 채널 upper = base
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "ch_ok_upper" : "ch_too_far", {
        ref, dist, distMax, midPrice, lo, hi, side, chMode: channel.mode
      });
      return ok;
    }
  }

    // 2) 채널 NONE이면 추세선 사용 + 방향 일치
  if (trend.mode !== "none" && trend.line) {
    if (trend.mode === "up") {
      if (side !== "bull") {
        mark(false, "tr_dir_mismatch", { side, trMode: trend.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = linePriceAt(trend.line, t);
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "tr_ok" : "tr_too_far", { ref, dist, distMax, midPrice, lo, hi, side, trMode: trend.mode });
      return ok;
    }

    if (trend.mode === "down") {
      if (side !== "bear") {
        mark(false, "tr_dir_mismatch", { side, trMode: trend.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = linePriceAt(trend.line, t);
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "tr_ok" : "tr_too_far", { ref, dist, distMax, midPrice, lo, hi, side, trMode: trend.mode });
      return ok;
    }
  }

  // 3) 컨텍스트 없으면 실패
  mark(false, "no_context", { distMax, midPrice, lo, hi });
  return false;
}



function linePriceAt(line: Line2P, t: UTCTimestamp) {
  const x1 = Number(line.t1);
  const x2 = Number(line.t2);
  if (x1 === x2) return line.p2;
  const m = (line.p2 - line.p1) / (x2 - x1);
  return line.p1 + m * (Number(t) - x1);
}

/* =========================
   ATR / Swings
========================= */
function computeATR(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const atr = new Array<number>(n).fill(NaN);
  if (n === 0) return atr;

  const tr = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    if (i === 0) {
      tr[i] = high - low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    const v1 = high - low;
    const v2 = Math.abs(high - prevClose);
    const v3 = Math.abs(low - prevClose);
    tr[i] = Math.max(v1, v2, v3);
  }

  if (n < period) return atr;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];

  let prevAtr = sum / period;
  atr[period - 1] = prevAtr;

  for (let i = period; i < n; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atr[i] = prevAtr;
  }
  return atr;
}

function findSwingHighsLows(candles: Candle[], pivotLen = 3) {
  const n = candles.length;
  const swingHigh = new Array<boolean>(n).fill(false);
  const swingLow = new Array<boolean>(n).fill(false);

  for (let i = pivotLen; i < n - pivotLen; i++) {
    let isHigh = true;
    let isLow = true;

    const ph = candles[i].high;
    const pl = candles[i].low;

    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j === i) continue;
      if (candles[j].high >= ph) isHigh = false;
      if (candles[j].low <= pl) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) swingHigh[i] = true;
    if (isLow) swingLow[i] = true;
  }

  return { swingHigh, swingLow };
}

type PivotPoint = { idx: number; t: UTCTimestamp; p: number };

/* =========================
   4H Channel + Trendline (spec)
========================= */
const PIVOT_LEN = 3;
const CHANNEL_LOOKBACK = 300;
const TREND_LOOKBACK = 600;

const CHANNEL_MIN_SWING_MULT = 0.25;
const TREND_MIN_SWING_MULT = 0.5;

const BREAK_ATR_MULT = 0.2;

function pickHLPair(pivotLowsAsc: PivotPoint[], atrNow: number, minSwingMult: number) {
  if (pivotLowsAsc.length < 2) return null;
  const L2 = pivotLowsAsc[pivotLowsAsc.length - 1];
  for (let k = pivotLowsAsc.length - 2; k >= 0; k--) {
    const L1 = pivotLowsAsc[k];
    if (!(L2.p > L1.p)) continue; // 동률 불허
    if (L2.p - L1.p < atrNow * minSwingMult) continue;
    return { L1, L2 };
  }
  return null;
}

function pickLHPair(pivotHighsAsc: PivotPoint[], atrNow: number, minSwingMult: number) {
  if (pivotHighsAsc.length < 2) return null;
  const H2 = pivotHighsAsc[pivotHighsAsc.length - 1];
  for (let k = pivotHighsAsc.length - 2; k >= 0; k--) {
    const H1 = pivotHighsAsc[k];
    if (!(H2.p < H1.p)) continue; // 동률 불허
    if (H1.p - H2.p < atrNow * minSwingMult) continue;
    return { H1, H2 };
  }
  return null;
}

/**
 * buildChannelFromScratch
 * - 2-b 구조 필터: HH/HL => up만, LH/LL => down만, mixed => none
 * - 2-a residual 표본: base.t2 이후 pivot만 사용 (추천)
 * - residual res>0만
 * - 표본 <5면 NONE
 */
function buildChannelFromScratch(candles4h: Candle[]): ChannelState {
  (window as any).__CH_DBG = {
    stage: "enter",
    at: Date.now(),
    candles: candles4h.length,
  };

  const dbgNone = (
    why: "mixed_or_range" | "anchor_fail" | "residual_sample_lt_5",
    detail = "",
    extra: any = {}
  ): ChannelState => {
    (window as any).__CH_DBG = {
      ...(window as any).__CH_DBG,
      stage: "return_none",
      why,
      detail,
      ...extra,
    };
    return { mode: "none", breakCount: 0, why };
  };

  const dbgOk = (st: ChannelState, extra: any = {}): ChannelState => {
    (window as any).__CH_DBG = {
      ...(window as any).__CH_DBG,
      stage: "return_ok",
      mode: st.mode,
      offset: st.offset ?? null,
      anchorStartTime: st.anchorStartTime ?? null,
      ...extra,
    };
    return st;
  };

   const none = (
    why: "mixed_or_range" | "anchor_fail" | "residual_sample_lt_5",
    detail = "",
    extra: any = {}
  ) => dbgNone(why, detail, extra);



  if (candles4h.length < CHANNEL_LOOKBACK + PIVOT_LEN * 2 + 20) {
    return none("anchor_fail");
  }

  const atr = computeATR(candles4h, 14);
  const atrNow = Number.isFinite(atr.at(-1) ?? NaN) ? (atr.at(-1) as number) : NaN;
  if (!Number.isFinite(atrNow) || atrNow <= 0) return none("anchor_fail");

  const startIdx = Math.max(0, candles4h.length - CHANNEL_LOOKBACK);
  const slice = candles4h.slice(startIdx);
  const { swingHigh, swingLow } = findSwingHighsLows(slice, PIVOT_LEN);

  const pivotHighs: PivotPoint[] = [];
  const pivotLows: PivotPoint[] = [];
  for (let i = 0; i < slice.length; i++) {
    if (swingHigh[i]) pivotHighs.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].high });
    if (swingLow[i]) pivotLows.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].low });
  }

  // 2-b) 구조 필터
  if (pivotHighs.length < 2 || pivotLows.length < 2) {
    return none("anchor_fail");
  }

  const hPrev = pivotHighs[pivotHighs.length - 2].p;
  const hLast = pivotHighs[pivotHighs.length - 1].p;
  const lPrev = pivotLows[pivotLows.length - 2].p;
  const lLast = pivotLows[pivotLows.length - 1].p;

  const isUp = hLast > hPrev && lLast > lPrev;
  const isDown = hLast < hPrev && lLast < lPrev;

  if (!isUp && !isDown) {
    return none("mixed_or_range");
  }

  // UP 채널
  if (isUp) {
    const upPair = pickHLPair(pivotLows, atrNow, CHANNEL_MIN_SWING_MULT);
    if (!upPair) return none("anchor_fail");

    const base: Line2P = { t1: upPair.L1.t, p1: upPair.L1.p, t2: upPair.L2.t, p2: upPair.L2.p };
// ✅ base 검증: up 채널인데 low가 base를 너무 자주/크게 깨면 NONE
{
  const BREACH = atrNow * 0.2;      // 허용 이탈폭 (추천: ATR*0.2)
  const RATIO_TH = 0.25;            // 허용 비율 (추천: 25%)
  const MIN_N = 20;                // 표본 최소 캔들 수

  let n = 0;
  let bad = 0;

  for (const c of slice) {
    if (Number(c.time) < Number(base.t1)) continue; // anchorStartTime 이후만
    const lp = linePriceAt(base, c.time);
    const breach = lp - c.low;                      // up 채널: base 아래로 깨진 정도
    n++;
    if (breach >= BREACH) bad++;
  }

  if (n >= MIN_N && bad / n >= RATIO_TH) {
    return none("anchor_fail");
  }
}

   // 2-a) residual 표본 제한: max(base.t2, base.t1) 이후 pivotHigh만
const cutoffT = Math.max(Number(base.t2), Number(base.t1));

const residuals: number[] = [];
for (const ph of pivotHighs) {
  if (Number(ph.t) < cutoffT) continue;
  const baseP = linePriceAt(base, ph.t);
  const res = ph.p - baseP;
  if (res > 0) residuals.push(res);
}

    const off = percentile95Positive(residuals);
    if (off == null) {
      (window as any).__CH_DBG = { why: "residual_sample_lt_5", count: residuals.length, side: "up" };
      return none("residual_sample_lt_5");
    }

    
      return dbgOk({
  mode: "up",
  base,
  offset: off,
  breakCount: 0,
  anchorStartTime: base.t1,
});

  }

  // DOWN 채널
  const dnPair = pickLHPair(pivotHighs, atrNow, CHANNEL_MIN_SWING_MULT);
  if (!dnPair) if (!dnPair) return none("anchor_fail");

  const base: Line2P = { t1: dnPair.H1.t, p1: dnPair.H1.p, t2: dnPair.H2.t, p2: dnPair.H2.p };

  // 2-a) residual 표본 제한: max(base.t2, base.t1) 이후 pivotLow만
const cutoffT = Math.max(Number(base.t2), Number(base.t1));

const residuals: number[] = [];
for (const pl of pivotLows) {
  if (Number(pl.t) < cutoffT) continue;
  const baseP = linePriceAt(base, pl.t);
  const res = baseP - pl.p;
  if (res > 0) residuals.push(res);
}


  const off = percentile95Positive(residuals);
  if (off == null) {
    (window as any).__CH_DBG = { why: "residual_sample_lt_5", count: residuals.length, side: "down" };
    return none("residual_sample_lt_5");
  }

  return {
    mode: "down",
    base,
    offset: off,
    breakCount: 0,
    anchorStartTime: base.t1,
  };
}

function updateLockedChannel(prev: ChannelState, candles4h: Candle[]): ChannelState {
  // 채널 NONE이거나 파라미터 없으면: 매 4H close마다 재시도 OK
  if (prev.mode === "none" || !prev.base || !prev.offset) {
    return buildChannelFromScratch(candles4h);
  }

  const atr = computeATR(candles4h, 14);
  const i = candles4h.length - 1;
  if (i <= 0) return prev;

  const atrNow = atr[i];
  if (!Number.isFinite(atrNow) || atrNow <= 0) return prev;

  const c = candles4h[i];
  const lineP = linePriceAt(prev.base, c.time);
  if (!Number.isFinite(lineP)) return prev;

  const BREACH = atrNow * 0.2;

  // up: 종가가 base(지지) 아래로 BREACH 이상 이탈
  // down: 종가가 base(저항) 위로 BREACH 이상 이탈
  const breach = prev.mode === "up" ? (lineP - c.close) : (c.close - lineP);
  const validBreach = breach >= BREACH;

  const newCount = validBreach ? (prev.breakCount ?? 0) + 1 : 0;

  // ✅ 2연속이면 Break 확정 → 두 번째 봉 close에서 즉시 재생성
  if (newCount >= 2) {
    return buildChannelFromScratch(candles4h);
  }

  return { ...prev, breakCount: newCount };
}


/* =========================
   Trendline (spec)
========================= */
function buildTrendlineFromScratch(
  candles4h: Candle[],
  keepIfRange: TrendlineState | null
): TrendlineState {
  if (candles4h.length < TREND_LOOKBACK + PIVOT_LEN * 2 + 20) {
    return keepIfRange ?? { mode: "none", breakCount: 0 };
  }

  const atr = computeATR(candles4h, 14);
  const atrNow = Number.isFinite(atr.at(-1) ?? NaN) ? (atr.at(-1) as number) : NaN;
  if (!Number.isFinite(atrNow) || atrNow <= 0) {
  (window as any).__TR_DBG = { stage: "atr_invalid", atrNow, len: candles4h.length, at: candles4h.at(-1)?.time };
  return { mode: "none", breakCount: 0, why: "anchor_fail" };
}


  const startIdx = Math.max(0, candles4h.length - TREND_LOOKBACK);
  const slice = candles4h.slice(startIdx);
  const { swingHigh, swingLow } = findSwingHighsLows(slice, PIVOT_LEN);

  const pivotHighs: PivotPoint[] = [];
  const pivotLows: PivotPoint[] = [];
  for (let i = 0; i < slice.length; i++) {
    if (swingHigh[i]) pivotHighs.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].high });
    if (swingLow[i]) pivotLows.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].low });
  }

  // =========================
// 2-b) 구조 필터로 채널 방향 강제
// HH/HL => up만, LH/LL => down만, mixed => NONE
// =========================
if (pivotHighs.length < 2 || pivotLows.length < 2) {
  (window as any).__TR_DBG = {
    stage: "insufficient_pivots",
    pivotHighs: pivotHighs.length,
    pivotLows: pivotLows.length,
    at: candles4h.at(-1)?.time,
  };
  return { mode: "none", breakCount: 0, why: "anchor_fail" };
}


const hPrev = Number(pivotHighs[pivotHighs.length - 2].p);
const hLast = Number(pivotHighs[pivotHighs.length - 1].p);
const lPrev = Number(pivotLows[pivotLows.length - 2].p);
const lLast = Number(pivotLows[pivotLows.length - 1].p);

const finite4 =
  Number.isFinite(hPrev) &&
  Number.isFinite(hLast) &&
  Number.isFinite(lPrev) &&
  Number.isFinite(lLast);

const isUp = finite4 && hLast > hPrev && lLast > lPrev;
const isDown = finite4 && hLast < hPrev && lLast < lPrev;

const structExtra = {
  hPrev,
  hLast,
  lPrev,
  lLast,
  isUp,
  isDown,
  at: candles4h.at(-1)?.time,
};

if (isUp && isDown) {
  (window as any).__TR_DBG = {
    stage: "mixed_or_range",
    detail: "both true (unexpected)",
    ...structExtra,
  };
  return keepIfRange ?? { mode: "none", breakCount: 0, why: "mixed_or_range" };
}

if (!isUp && !isDown) {
  (window as any).__TR_DBG = {
    stage: "mixed_or_range",
    detail: `PH ${hPrev}→${hLast}, PL ${lPrev}→${lLast}`,
    ...structExtra,
  };
  return keepIfRange ?? { mode: "none", breakCount: 0, why: "mixed_or_range" };
}



  if (isUp) {
    const pair = pickHLPair(pivotLows, atrNow, TREND_MIN_SWING_MULT);
    if (!pair) {
  (window as any).__TR_DBG = { stage: "anchor_fail_up", at: candles4h.at(-1)?.time };
  return { mode: "none", breakCount: 0, why: "anchor_fail" };
}

    const line: Line2P = { t1: pair.L1.t, p1: pair.L1.p, t2: pair.L2.t, p2: pair.L2.p };
    return { mode: "up", line, breakCount: 0, anchorStartTime: line.t1 };
  }

  const pair = pickLHPair(pivotHighs, atrNow, TREND_MIN_SWING_MULT);
  if (!pair) {
  (window as any).__TR_DBG = { stage: "anchor_fail_down", at: candles4h.at(-1)?.time };
  return { mode: "none", breakCount: 0, why: "anchor_fail" };
}

  const line: Line2P = { t1: pair.H1.t, p1: pair.H1.p, t2: pair.H2.t, p2: pair.H2.p };
  return { mode: "down", line, breakCount: 0, anchorStartTime: line.t1 };
}

function updateLockedTrendline(prev: TrendlineState, candles4h: Candle[]): TrendlineState {
  if (prev.mode === "none" || !prev.line) {
    return buildTrendlineFromScratch(candles4h, prev.mode === "none" ? null : prev);
  }

  const atr = computeATR(candles4h, 14);
  const i = candles4h.length - 1;
  if (i <= 0) return prev;

  const atrNow = atr[i];
  if (!Number.isFinite(atrNow) || atrNow <= 0) return prev;

  const c = candles4h[i];
  const lineP = linePriceAt(prev.line, c.time);
  if (!Number.isFinite(lineP)) return prev;

  const BREACH = atrNow * 0.2;

  // up: 종가가 선 아래로 BREACH 이상 이탈
  // down: 종가가 선 위로 BREACH 이상 이탈
  const breach = prev.mode === "up" ? (lineP - c.close) : (c.close - lineP);
  const validBreach = breach >= BREACH;

  const newCount = validBreach ? (prev.breakCount ?? 0) + 1 : 0;

  // ✅ 2연속이면 Break 확정 → 즉시 재선정/재생성
  if (newCount >= 2) {
    return buildTrendlineFromScratch(candles4h, null);
  }

  return { ...prev, breakCount: newCount };
}


/* =========================
   4H BOS/CHOCH + Sweep helpers (confirmed pivots only)
========================= */
type StructureSignals = {
  bosUp: boolean[];
  bosDown: boolean[];
  chochUp: boolean[];
  chochDown: boolean[];
  sweepUp: boolean[]; // recovery close index
  sweepDown: boolean[]; // recovery close index
};

function computeStructureSignals(candles4h: Candle[], atr: number[]): StructureSignals {
  const n = candles4h.length;
  const { swingHigh, swingLow } = findSwingHighsLows(candles4h, PIVOT_LEN);

  const bosUp = new Array<boolean>(n).fill(false);
  const bosDown = new Array<boolean>(n).fill(false);
  const chochUp = new Array<boolean>(n).fill(false);
  const chochDown = new Array<boolean>(n).fill(false);
  const sweepUp = new Array<boolean>(n).fill(false);
  const sweepDown = new Array<boolean>(n).fill(false);

  const phList: PivotPoint[] = [];
  const plList: PivotPoint[] = [];

  let structureMode: "up" | "down" | "range" = "range";
  let lastHL: PivotPoint | null = null;
  let lastLH: PivotPoint | null = null;

  let lastBosUpPivotIdx = -1;
  let lastBosDownPivotIdx = -1;

  for (let i = 0; i < n; i++) {
    // confirm pivot at (i - PIVOT_LEN)
    const p = i - PIVOT_LEN;
    if (p >= 0) {
      if (swingHigh[p]) phList.push({ idx: p, t: candles4h[p].time, p: candles4h[p].high });
      if (swingLow[p]) plList.push({ idx: p, t: candles4h[p].time, p: candles4h[p].low });

      if (phList.length >= 2 && plList.length >= 2) {
        const hPrev = phList[phList.length - 2].p;
        const hLast = phList[phList.length - 1].p;
        const lPrev = plList[plList.length - 2].p;
        const lLast = plList[plList.length - 1].p;

        const isUp = hLast > hPrev && lLast > lPrev;
        const isDown = hLast < hPrev && lLast < lPrev;

        if (isUp) {
          structureMode = "up";
          // HL 갱신(진짜 higher low일 때만)
          const prevPL = plList.length >= 2 ? plList[plList.length - 2] : null;
          const curPL = plList[plList.length - 1];
          if (prevPL && curPL.p > prevPL.p) lastHL = curPL;
        } else if (isDown) {
          structureMode = "down";
          // LH 갱신(진짜 lower high일 때만)
          const prevPH = phList.length >= 2 ? phList[phList.length - 2] : null;
          const curPH = phList[phList.length - 1];
          if (prevPH && curPH.p < prevPH.p) lastLH = curPH;
        } else {
          structureMode = "range";
        }
      }
    }

    const prevClose = i > 0 ? candles4h[i - 1].close : candles4h[i].close;

    const lastPH = phList.length ? phList[phList.length - 1] : null;
    const lastPL = plList.length ? plList[plList.length - 1] : null;

    // BOS
    if (lastPH && lastPH.idx > lastBosUpPivotIdx) {
      if (prevClose <= lastPH.p && candles4h[i].close > lastPH.p) {
        bosUp[i] = true;
        lastBosUpPivotIdx = lastPH.idx;
      }
    }

    if (lastPL && lastPL.idx > lastBosDownPivotIdx) {
      if (prevClose >= lastPL.p && candles4h[i].close < lastPL.p) {
        bosDown[i] = true;
        lastBosDownPivotIdx = lastPL.idx;
      }
    }

    // CHOCH
    if (structureMode === "up" && lastHL) {
      if (prevClose >= lastHL.p && candles4h[i].close < lastHL.p) chochDown[i] = true;
    }
    if (structureMode === "down" && lastLH) {
      if (prevClose <= lastLH.p && candles4h[i].close > lastLH.p) chochUp[i] = true;
    }

    // Sweep -> Recovery (recovery close index = i)
    if (i >= 1) {
      const sweepBar = candles4h[i - 1];
      const recBar = candles4h[i];
      const a = Number.isFinite(atr[i - 1]) ? atr[i - 1] : 0;
      const eqTol = a * 0.1;

      const lastPH2 = phList.length >= 2 ? phList[phList.length - 2] : null;
      const lastPH1 = phList.length >= 1 ? phList[phList.length - 1] : null;
      const lastPL2 = plList.length >= 2 ? plList[plList.length - 2] : null;
      const lastPL1 = plList.length >= 1 ? plList[plList.length - 1] : null;

      let eqh: number | null = null;
      if (lastPH2 && lastPH1 && Math.abs(lastPH1.p - lastPH2.p) <= eqTol) {
        eqh = Math.max(lastPH1.p, lastPH2.p);
      }

      let eql: number | null = null;
      if (lastPL2 && lastPL1 && Math.abs(lastPL1.p - lastPL2.p) <= eqTol) {
        eql = Math.min(lastPL1.p, lastPL2.p);
      }

      // Up sweep + recovery close below
      const upTargets: number[] = [];
      if (eqh != null) upTargets.push(eqh);
      if (lastPH1) upTargets.push(lastPH1.p);

      for (const lvl of upTargets) {
        if (sweepBar.high > lvl && recBar.close < lvl) {
          sweepUp[i] = true;
          break;
        }
      }

      // Down sweep + recovery close above
      const dnTargets: number[] = [];
      if (eql != null) dnTargets.push(eql);
      if (lastPL1) dnTargets.push(lastPL1.p);

      for (const lvl of dnTargets) {
        if (sweepBar.low < lvl && recBar.close > lvl) {
          sweepDown[i] = true;
          break;
        }
      }
    }
  }

  return { bosUp, bosDown, chochUp, chochDown, sweepUp, sweepDown };
}

/* =========================
   A+ OB (4H only) + A-grade FVG (4H only)
========================= */
const MAX_ZONES = 80;



function computeAPlusOBAndAFVG(
  candles4h: Candle[],
  channel: ChannelState,
  trend: TrendlineState
): Zone[] {
  const n = candles4h.length;
  if (n < 120) return [];

  const atr = computeATR(candles4h, 14);
  const sig = computeStructureSignals(candles4h, atr);

  const zones: Zone[] = [];
// ===== DEBUG: reset CTX per compute run =====
const g: any = window as any;
g.__CTX = {
  calls: 0,
  pass: 0,
  fail: 0,
  reasons: {},
  last: null,
  ts: Date.now(),
};


  // ========= A+ OB =========
  for (let k = 0; k < n; k++) {
    const bullImpulse = sig.bosUp[k] || sig.chochUp[k];
    const bearImpulse = sig.bosDown[k] || sig.chochDown[k];
    if (!bullImpulse && !bearImpulse) continue;

    const side: "bull" | "bear" = bullImpulse ? "bull" : "bear";
    const atrK = Number.isFinite(atr[k]) ? atr[k] : NaN;
    if (!Number.isFinite(atrK) || atrK <= 0) continue;

    // displacement(3): max body > ATR*1.0 OR sum3 > ATR*1.8
    const b0 = Math.max(0, k - 2);
    let maxBody = 0;
    let sumBody = 0;
    for (let i = b0; i <= k; i++) {
      const body = Math.abs(candles4h[i].close - candles4h[i].open);
      maxBody = Math.max(maxBody, body);
      sumBody += body;
    }
    const hasDisplacement = maxBody > atrK * 1.0 || sumBody > atrK * 1.8;
    if (!hasDisplacement) continue;

    // sweep->recovery required within [k-20..k]
    const wStart = Math.max(0, k - 20);
    let hasSweep = false;
    for (let i = wStart; i <= k; i++) {
      if (side === "bull" && sig.sweepDown[i]) {
        hasSweep = true;
        break;
      }
      if (side === "bear" && sig.sweepUp[i]) {
        hasSweep = true;
        break;
      }
    }
    if (!hasSweep) continue;

    // find OB candle: last opposite color in [k-20..k], prefer inside [k-3..k]
    const impulseStart = Math.max(0, k - 3);
    let obIdx: number | null = null;
    let obIdxFallback: number | null = null;

    for (let j = k; j >= wStart; j--) {
      const c = candles4h[j];
      const isOpp = side === "bull" ? c.close < c.open : c.close > c.open;
      if (!isOpp) continue;

      if (j >= impulseStart) {
        obIdx = j;
        break;
      }
      if (obIdxFallback == null) obIdxFallback = j;
    }

    if (obIdx == null) obIdx = obIdxFallback;
    if (obIdx == null) continue;

    const ob = candles4h[obIdx];

    // doji 기본 제외(|c-o|>=0.1*ATR), 예외는 (구조+변위+스윕) 만족 시 허용 => 지금 이미 다 만족했으니 통과
    // 단, 너무 심한 노이즈 줄이고 싶으면 여기서 continue 걸어도 됨.

    // OB zone: bull open~low, bear open~high
    const top = side === "bull" ? ob.open : ob.high;
    const bottom = side === "bull" ? ob.low : ob.open;

    const mid = (top + bottom) / 2;

    // 컨텍스트/거리 + 방향 일치 필수
    if (!passesContextDistance(side, mid, ob.time, atrK, channel, trend, top, bottom)) continue;

    // invalidate simulation: break 2연속 OR touch>=3(침투>=ATR*0.1, 재진입만 카운트)
    let touchCount = 0;
    let invBreakCount = 0;
    let active = true;
    let invalidReason: ZoneInvalidReason | undefined = undefined;
    let endTime: UTCTimestamp | undefined = undefined;

    let inTouch = false;

    for (let i = obIdx + 1; i < n; i++) {
      const c = candles4h[i];
      const ai = Number.isFinite(atr[i]) ? atr[i] : atrK;
      if (!Number.isFinite(ai) || ai <= 0) continue;

      // break invalidation
      if (side === "bull") {
        const breach = bottom - c.close;
        const validBreach = c.close < bottom && breach >= ai * BREAK_ATR_MULT;
        invBreakCount = validBreach ? invBreakCount + 1 : 0;
        if (invBreakCount >= 2) {
          active = false;
          invalidReason = "break";
          endTime = to4hCloseTime(c.time);
          break;
        }
      } else {
        const breach = c.close - top;
        const validBreach = c.close > top && breach >= ai * BREAK_ATR_MULT;
        invBreakCount = validBreach ? invBreakCount + 1 : 0;
        if (invBreakCount >= 2) {
          active = false;
          invalidReason = "break";
          endTime = to4hCloseTime(c.time);
          break;
        }
      }

      // touches (재진입만 카운트)
      const overlaps = c.low <= top && c.high >= bottom;
      if (!overlaps) {
        inTouch = false;
        continue;
      }

      const penetration =
        side === "bull"
          ? top - Math.min(c.low, top)
          : Math.max(c.high, bottom) - bottom;

      const isRealTouch = penetration >= ai * 0.1;

      if (isRealTouch && !inTouch) {
        touchCount++;
        inTouch = true;
        if (touchCount >= 3) {
          active = false;
          invalidReason = "touches";
          endTime = to4hCloseTime(c.time);
          break;
        }
      }
    }

    zones.push({
      kind: "OB",
      side,
      top,
      bottom,
      startTime: ob.time,
      endTime,
      active,
      invalidReason,
      touchCount,
    });
  }

  // ========= A-grade FVG =========
  for (let i = 1; i < n - 1; i++) {
    const cPrev = candles4h[i - 1];
    const cMid = candles4h[i];
    const cNext = candles4h[i + 1];

    const atrI = Number.isFinite(atr[i]) ? atr[i] : NaN;
    if (!Number.isFinite(atrI) || atrI <= 0) continue;

    // 3-candle wick FVG
    let side: "bull" | "bear" | null = null;
    let top = 0;
    let bottom = 0;

    if (cPrev.high < cNext.low) {
      side = "bull";
      bottom = cPrev.high;
      top = cNext.low;
    } else if (cPrev.low > cNext.high) {
      side = "bear";
      bottom = cNext.high;
      top = cPrev.low;
    }

    if (!side) continue;

        // confirm index = i+1 close
      const conf = i + 1;
      if (conf >= n) continue;

      const confTime = candles4h[conf].time; // i+1 close 시점
      const atrConf = Number.isFinite(atr[conf]) ? atr[conf] : atrI; // conf ATR (fallback: atrI)

      // midPrice는 zone 중앙값
      const midPrice = (top + bottom) / 2;

      // NOTE: 컨텍스트(F4)는 아래 extra(F2/F3/F4) 계산에 포함. 여기서 강제 continue 금지.

    // F1 displacement (필수)
    const b1 = Math.abs(cPrev.close - cPrev.open);
    const b2 = Math.abs(cMid.close - cMid.open);
    const b3 = Math.abs(cNext.close - cNext.open);
    const maxBody = Math.max(b1, b2, b3);
    const sumBody = b1 + b2 + b3;
    const F1 = maxBody > atrI * 1.0 || sumBody > atrI * 1.8;
    if (!F1) continue;

    const w0 = Math.max(0, conf - 3);
    const w1 = Math.min(n - 1, conf + 3);

    // F2: ±3에 BOS/CHOCH same dir
    let F2 = false;
    for (let k = w0; k <= w1; k++) {
      if (side === "bull" && (sig.bosUp[k] || sig.chochUp[k])) {
        F2 = true;
        break;
      }
      if (side === "bear" && (sig.bosDown[k] || sig.chochDown[k])) {
        F2 = true;
        break;
      }
    }

    // F3: sweep->recovery (bull: sweepDown, bear: sweepUp) within ±3
    let F3 = false;
    for (let k = w0; k <= w1; k++) {
      if (side === "bull" && sig.sweepDown[k]) {
        F3 = true;
        break;
      }
      if (side === "bear" && sig.sweepUp[k]) {
        F3 = true;
        break;
      }
    }

    // F4: context distance + direction
    const F4 = passesContextDistance(side, midPrice, confTime, atrConf, channel, trend, top, bottom);

    const extra = (F2 ? 1 : 0) + (F3 ? 1 : 0) + (F4 ? 1 : 0);
    if (extra < 2) continue;

    // invalidate simulation:
    // - full fill 1회(즉시)
    // - opposite CHOCH
    // - touch>=3 (재진입 카운트)
    let touchCount = 0;
    let active = true;
    let invalidReason: ZoneInvalidReason | undefined = undefined;
    let endTime: UTCTimestamp | undefined = undefined;
    let inTouch = false;

    for (let j = conf + 1; j < n; j++) {
      const c = candles4h[j];
      const aj = Number.isFinite(atr[j]) ? atr[j] : atrI;

      // full fill (wick 기준)
      const fullFilled =
        side === "bull"
          ? c.low <= bottom // bull: bottom까지 완전 메움
          : c.high >= top;  // bear: top까지 완전 메움

      if (fullFilled) {
        active = false;
        invalidReason = "fullfill";
        endTime = to4hCloseTime(c.time);
        break;
      }

      // opposite CHOCH (종가 기준)
      if (side === "bull" && sig.chochDown[j]) {
        active = false;
        invalidReason = "choch";
        endTime = to4hCloseTime(c.time);
        break;
      }
      if (side === "bear" && sig.chochUp[j]) {
        active = false;
        invalidReason = "choch";
        endTime = to4hCloseTime(c.time);
        break;
      }

      // touch>=3 (wick 기준 + 재진입)
      const overlaps = c.low <= top && c.high >= bottom;
      if (!overlaps) {
        inTouch = false;
        continue;
      }

      // penetration(진짜 터치 강도는 간단히 zone 내부 진입으로 처리)
      // 원하면 여기서 ai*0.1 같은 최소 침투를 추가 가능
      if (!inTouch) {
        touchCount++;
        inTouch = true;
        if (touchCount >= 3) {
          active = false;
          invalidReason = "touches";
          endTime = to4hCloseTime(c.time);
          break;
        }
      }
    }

    zones.push({
      kind: "FVG",
      side,
      top,
      bottom,
      startTime: cMid.time,
      endTime,
      active,
      invalidReason,
      touchCount,
    });
  }

  zones.sort((a, b) => Number(a.startTime) - Number(b.startTime));

  function dedupeZones(zs: Zone[]) {
    const m = new Map<string, Zone>();
    for (const z of zs) {
      const key =
        `${z.kind}|${z.side}|${z.startTime}|` +
        `${Math.round(z.top * 100)}|${Math.round(z.bottom * 100)}`;

      const prev = m.get(key);
      if (!prev) m.set(key, z);
      else {
        if (!prev.active && z.active) m.set(key, z);
      }
    }
    return Array.from(m.values());
  }

  const deduped = dedupeZones(zones);
  return deduped.length > MAX_ZONES ? deduped.slice(deduped.length - MAX_ZONES) : deduped;
}

/* =========================
   Binance fetch (pagination)
========================= */
function toBinanceInterval(tf: string) {
  switch (tf) {
    case "3m":
      return "3m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "30m":
      return "30m";
    case "1H":
    case "1h":
      return "1h";
    case "2H":
    case "2h":
      return "2h";
    case "4H":
    case "4h":
      return "4h";
    default:
      return "15m";
  }
}

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
// D) 다음 페이지(더 과거)로 이동하기 위해 endTimeMs 갱신
if (!batch || batch.length === 0) break;

// Binance klines는 보통 시간 오름차순으로 오므로 batch[0]이 "가장 과거" 캔들
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
  const interval = useMemo(() => toBinanceInterval(tf), [tf]);

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

const LTF_TARGET_CANDLES = 2000; // 초기 로드
const LTF_MAX_CANDLES = 3000;    // 메모리 최대
const LTF_LOAD_MORE_STEP = 1500; // 더 불러오기 1회 최대치

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

  // ===== drawOverlay =====
  function drawDebugHUD(ctx: CanvasRenderingContext2D) {
  const g: any = window as any;

  const ch = g.__CH_DBG;
  const tr = g.__TR_DBG;
  const z  = g.__Z_DBG; // 있으면 사용(없으면 안 나옴)
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

      const forwardSec = MAX_FORWARD_BARS * SEC_4H; // ✅ ALWAYS 4H 기준 (스펙 고정)

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
      const inactive = inactiveAll.slice(Math.max(0, inactiveAll.length - 20)); // 비활성 20개만
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
    } finally {
      if (DEBUG_HUD) drawDebugHUD(ctx);
      ctx.restore();
    }
  }, [MAX_FORWARD_BARS, SHOW_INACTIVE_LABELS, SHOW_INACTIVE_ZONES, TRENDLINE_STROKE, tf, updateRightScaleW]);

  const scheduleDrawOverlay = useCallback(() => {
    if (overlayRafRef.current != null) return;
    overlayRafRef.current = window.requestAnimationFrame(() => {
      overlayRafRef.current = null;
      drawOverlay();
    });
  }, [drawOverlay]);

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
      setError(e?.message ?? "과거 데이터 로드 실패");
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

        chart.timeScale().fitContent();

        syncFromStore();
        updateRightScaleW();
        scheduleDrawOverlay();
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "데이터 로드 실패");
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
        const nextChannel = updateLockedChannel(prev.channel, data4h);
        const nextTrend = updateLockedTrendline(prev.trend, data4h);
        const nextZones = computeAPlusOBAndAFVG(data4h, nextChannel, nextTrend);

        const next: H4Context = {
          channel: nextChannel,
          trend: nextTrend,
          zones: nextZones,
          last4hTime: data4h.at(-1)?.time,
        };

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
        // ===== Engine hook: ONLY on candle close =====
        if (msg.k.x) {
          const tfEnum = intervalToTF(interval);
          // H4는 아래 ws4h에서 따로 처리하므로 여기서는 제외
          if (tfEnum && tfEnum !== "H4") {
            const openMs = msg.k.t;
            const closeMs = msg.k.T ?? openMs + tfDurationMs(tfEnum);

            const bar: Bar = {
              tf: tfEnum,
              openTime: openMs,
              closeTime: closeMs,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            };

            const engine = getOrInitEngine(symbol);
            const evs = engine.onBarClose(bar);
            if (evs.length) console.log(evs.join("\n"));
          }
        }

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
                    const bar: Bar = {
            tf: "H4",
            openTime: msg.k.t,
            closeTime: msg.k.T ?? msg.k.t + tfDurationMs("H4"),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          };

          const engine = getOrInitEngine(symbol);
          const evs = engine.onBarClose(bar);
          if (evs.length) console.log(evs.join("\n"));

          const prev = getOrInitH4(symbol);
          const nextChannel = updateLockedChannel(prev.channel, arr);
          const nextTrend = updateLockedTrendline(prev.trend, arr);
          // ===== DEBUG: reset CTX per compute run =====
const g: any = window as any;
g.__CTX = {
  calls: 0,
  pass: 0,
  fail: 0,
  reasons: {},
  last: null,
  ts: Date.now(),
};

          const nextZones = computeAPlusOBAndAFVG(arr, nextChannel, nextTrend);

          const next: H4Context = {
            channel: nextChannel,
            trend: nextTrend,
            zones: nextZones,
            last4hTime: c.time,
          };

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
          현재가: {lastPrice.toFixed(2)}
        </div>
      )}

      <div className="absolute left-3 bottom-16 z-50 pointer-events-auto">
        <button
          onClick={handleLoadMore}
          disabled={isLoadingMore}
          className="rounded bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          {isLoadingMore ? "불러오는 중..." : "과거 더 불러오기"}
        </button>
      </div>
    </div>
  );
}
