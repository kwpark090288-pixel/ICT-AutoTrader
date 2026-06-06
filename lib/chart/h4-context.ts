export type ChartUnixTime = number;

export type Candle = {
  time: ChartUnixTime;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type Line2P = {
  t1: ChartUnixTime;
  p1: number;
  t2: ChartUnixTime;
  p2: number;
};

export type ZoneKind = "OB" | "FVG";
export type ZoneInvalidReason = "break" | "touches" | "fullfill" | "choch";

export type Zone = {
  kind: ZoneKind;
  side: "bull" | "bear";
  top: number;
  bottom: number;
  startTime: ChartUnixTime;
  endTime?: ChartUnixTime;
  active: boolean;
  invalidReason?: ZoneInvalidReason;
  touchCount?: number;
};

export type ChannelNoneWhy =
  | "mixed_or_range"
  | "anchor_fail"
  | "residual_sample_lt_5"
  | "insufficient_data"
  | "no_atr";

export type TrendNoneWhy =
  | "mixed_or_range"
  | "anchor_fail"
  | "insufficient_data"
  | "no_atr";

export type ChannelState = {
  mode: "up" | "down" | "none";
  base?: Line2P;
  offset?: number;
  breakCount: number;
  anchorStartTime?: ChartUnixTime;
  why?: ChannelNoneWhy;
};

export type TrendlineState = {
  mode: "up" | "down" | "none";
  line?: Line2P;
  breakCount: number;
  anchorStartTime?: ChartUnixTime;
  why?: TrendNoneWhy;
};

export type H4Context = {
  channel: ChannelState;
  trend: TrendlineState;
  zones: Zone[];
  last4hTime?: ChartUnixTime;
};

type PivotPoint = { idx: number; t: ChartUnixTime; p: number };

type StructureSignals = {
  bosUp: boolean[];
  bosDown: boolean[];
  chochUp: boolean[];
  chochDown: boolean[];
  sweepUp: boolean[];
  sweepDown: boolean[];
};

const SEC_4H = 4 * 60 * 60;
const CONTEXT_ATR_MULT = 0.25;
const PIVOT_LEN = 3;
const CHANNEL_LOOKBACK = 300;
const TREND_LOOKBACK = 600;
const CHANNEL_MIN_SWING_MULT = 0.25;
const TREND_MIN_SWING_MULT = 0.5;
const BREAK_ATR_MULT = 0.2;
const MAX_ZONES = 80;

function setDebugState(key: string, value: unknown) {
  (globalThis as Record<string, unknown>)[key] = value;
}

function to4hCloseTime(t: ChartUnixTime): ChartUnixTime {
  return Number(t) + SEC_4H;
}

function percentile95Positive(values: number[]): number | null {
  const arr = values.filter((v) => Number.isFinite(v) && v > 0);
  if (arr.length < 5) return null;
  arr.sort((a, b) => a - b);
  const idx = Math.floor((arr.length - 1) * 0.95);
  return arr[idx];
}

function channelBoundaryPriceAt(
  ch: ChannelState,
  t: ChartUnixTime,
  which: "lower" | "upper"
) {
  const baseP = linePriceAt(ch.base!, t);
  if (ch.mode === "up") {
    return which === "lower" ? baseP : baseP + (ch.offset ?? 0);
  }
  return which === "upper" ? baseP : baseP - (ch.offset ?? 0);
}

export function linePriceAt(line: Line2P, t: ChartUnixTime) {
  const x1 = Number(line.t1);
  const x2 = Number(line.t2);
  if (x1 === x2) return line.p2;
  const m = (line.p2 - line.p1) / (x2 - x1);
  return line.p1 + m * (Number(t) - x1);
}

function passesContextDistance(
  side: "bull" | "bear",
  midPrice: number,
  t: ChartUnixTime,
  atrNow: number,
  channel: ChannelState,
  trend: TrendlineState,
  zoneTop?: number,
  zoneBottom?: number
) {
  const distMax = atrNow * CONTEXT_ATR_MULT;
  const hasZone =
    Number.isFinite(zoneTop ?? NaN) && Number.isFinite(zoneBottom ?? NaN);
  const lo = hasZone ? Math.min(zoneTop as number, zoneBottom as number) : midPrice;
  const hi = hasZone ? Math.max(zoneTop as number, zoneBottom as number) : midPrice;

  const distToRange = (ref: number) => {
    if (ref < lo) return lo - ref;
    if (ref > hi) return ref - hi;
    return 0;
  };

  const g = globalThis as Record<string, any>;
  if (!g.__CTX) g.__CTX = { calls: 0, pass: 0, fail: 0, reasons: {}, last: null };

  const mark = (ok: boolean, why: string, detail: Record<string, unknown> = {}) => {
    const ctx = g.__CTX;
    if (!ctx) return;

    ctx.calls = (ctx.calls ?? 0) + 1;
    if (ok) ctx.pass = (ctx.pass ?? 0) + 1;
    else ctx.fail = (ctx.fail ?? 0) + 1;
    ctx.reasons = ctx.reasons ?? {};
    ctx.reasons[why] = (ctx.reasons[why] ?? 0) + 1;
    ctx.last = { ok, why, ...detail };
  };

  if (channel.mode !== "none" && channel.base) {
    if (channel.mode === "up") {
      if (side !== "bull") {
        mark(false, "ch_dir_mismatch", { side, chMode: channel.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = channelBoundaryPriceAt(channel, t, "lower");
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "ch_ok_lower" : "ch_too_far", {
        ref,
        dist,
        distMax,
        midPrice,
        lo,
        hi,
        side,
        chMode: channel.mode,
      });
      return ok;
    }

    if (side !== "bear") {
      mark(false, "ch_dir_mismatch", { side, chMode: channel.mode, distMax, midPrice, lo, hi });
      return false;
    }
    const ref = channelBoundaryPriceAt(channel, t, "upper");
    const dist = distToRange(ref);
    const ok = dist <= distMax;
    mark(ok, ok ? "ch_ok_upper" : "ch_too_far", {
      ref,
      dist,
      distMax,
      midPrice,
      lo,
      hi,
      side,
      chMode: channel.mode,
    });
    return ok;
  }

  if (trend.mode !== "none" && trend.line) {
    if (trend.mode === "up") {
      if (side !== "bull") {
        mark(false, "tr_dir_mismatch", { side, trMode: trend.mode, distMax, midPrice, lo, hi });
        return false;
      }
      const ref = linePriceAt(trend.line, t);
      const dist = distToRange(ref);
      const ok = dist <= distMax;
      mark(ok, ok ? "tr_ok" : "tr_too_far", {
        ref,
        dist,
        distMax,
        midPrice,
        lo,
        hi,
        side,
        trMode: trend.mode,
      });
      return ok;
    }

    if (side !== "bear") {
      mark(false, "tr_dir_mismatch", { side, trMode: trend.mode, distMax, midPrice, lo, hi });
      return false;
    }
    const ref = linePriceAt(trend.line, t);
    const dist = distToRange(ref);
    const ok = dist <= distMax;
    mark(ok, ok ? "tr_ok" : "tr_too_far", {
      ref,
      dist,
      distMax,
      midPrice,
      lo,
      hi,
      side,
      trMode: trend.mode,
    });
    return ok;
  }

  mark(false, "no_context", { distMax, midPrice, lo, hi });
  return false;
}

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
    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
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

function pickHLPair(
  pivotLowsAsc: PivotPoint[],
  atrNow: number,
  minSwingMult: number
) {
  if (pivotLowsAsc.length < 2) return null;
  const L2 = pivotLowsAsc[pivotLowsAsc.length - 1];
  for (let k = pivotLowsAsc.length - 2; k >= 0; k--) {
    const L1 = pivotLowsAsc[k];
    if (!(L2.p > L1.p)) continue;
    if (L2.p - L1.p < atrNow * minSwingMult) continue;
    return { L1, L2 };
  }
  return null;
}

function pickLHPair(
  pivotHighsAsc: PivotPoint[],
  atrNow: number,
  minSwingMult: number
) {
  if (pivotHighsAsc.length < 2) return null;
  const H2 = pivotHighsAsc[pivotHighsAsc.length - 1];
  for (let k = pivotHighsAsc.length - 2; k >= 0; k--) {
    const H1 = pivotHighsAsc[k];
    if (!(H2.p < H1.p)) continue;
    if (H1.p - H2.p < atrNow * minSwingMult) continue;
    return { H1, H2 };
  }
  return null;
}

export function buildChannelFromScratch(candles4h: Candle[]): ChannelState {
  setDebugState("__CH_DBG", {
    stage: "enter",
    at: Date.now(),
    candles: candles4h.length,
  });

  const none = (
    why: "mixed_or_range" | "anchor_fail" | "residual_sample_lt_5",
    detail = "",
    extra: Record<string, unknown> = {}
  ): ChannelState => {
    setDebugState("__CH_DBG", {
      ...(globalThis as Record<string, any>).__CH_DBG,
      stage: "return_none",
      why,
      detail,
      ...extra,
    });
    return { mode: "none", breakCount: 0, why };
  };

  const ok = (state: ChannelState, extra: Record<string, unknown> = {}): ChannelState => {
    setDebugState("__CH_DBG", {
      ...(globalThis as Record<string, any>).__CH_DBG,
      stage: "return_ok",
      mode: state.mode,
      offset: state.offset ?? null,
      anchorStartTime: state.anchorStartTime ?? null,
      ...extra,
    });
    return state;
  };

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
    if (swingHigh[i]) {
      pivotHighs.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].high });
    }
    if (swingLow[i]) {
      pivotLows.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].low });
    }
  }

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

  if (isUp) {
    const upPair = pickHLPair(pivotLows, atrNow, CHANNEL_MIN_SWING_MULT);
    if (!upPair) return none("anchor_fail");

    const base: Line2P = {
      t1: upPair.L1.t,
      p1: upPair.L1.p,
      t2: upPair.L2.t,
      p2: upPair.L2.p,
    };

    {
      const breachTol = atrNow * 0.2;
      const ratioTh = 0.25;
      const minN = 20;

      let n = 0;
      let bad = 0;

      for (const c of slice) {
        if (Number(c.time) < Number(base.t1)) continue;
        const lp = linePriceAt(base, c.time);
        const breach = lp - c.low;
        n += 1;
        if (breach >= breachTol) bad += 1;
      }

      if (n >= minN && bad / n >= ratioTh) {
        return none("anchor_fail");
      }
    }

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
      setDebugState("__CH_DBG", {
        why: "residual_sample_lt_5",
        count: residuals.length,
        side: "up",
      });
      return none("residual_sample_lt_5");
    }

    return ok({
      mode: "up",
      base,
      offset: off,
      breakCount: 0,
      anchorStartTime: base.t1,
    });
  }

  const dnPair = pickLHPair(pivotHighs, atrNow, CHANNEL_MIN_SWING_MULT);
  if (!dnPair) return none("anchor_fail");

  const base: Line2P = {
    t1: dnPair.H1.t,
    p1: dnPair.H1.p,
    t2: dnPair.H2.t,
    p2: dnPair.H2.p,
  };

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
    setDebugState("__CH_DBG", {
      why: "residual_sample_lt_5",
      count: residuals.length,
      side: "down",
    });
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

export function updateLockedChannel(
  prev: ChannelState,
  candles4h: Candle[]
): ChannelState {
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

  const breach = prev.mode === "up" ? lineP - c.close : c.close - lineP;
  const validBreach = breach >= atrNow * 0.2;
  const newCount = validBreach ? (prev.breakCount ?? 0) + 1 : 0;

  if (newCount >= 2) {
    return buildChannelFromScratch(candles4h);
  }

  return { ...prev, breakCount: newCount };
}

export function buildTrendlineFromScratch(
  candles4h: Candle[],
  keepIfRange: TrendlineState | null
): TrendlineState {
  if (candles4h.length < TREND_LOOKBACK + PIVOT_LEN * 2 + 20) {
    return keepIfRange ?? { mode: "none", breakCount: 0 };
  }

  const atr = computeATR(candles4h, 14);
  const atrNow = Number.isFinite(atr.at(-1) ?? NaN) ? (atr.at(-1) as number) : NaN;
  if (!Number.isFinite(atrNow) || atrNow <= 0) {
    setDebugState("__TR_DBG", {
      stage: "atr_invalid",
      atrNow,
      len: candles4h.length,
      at: candles4h.at(-1)?.time,
    });
    return { mode: "none", breakCount: 0, why: "anchor_fail" };
  }

  const startIdx = Math.max(0, candles4h.length - TREND_LOOKBACK);
  const slice = candles4h.slice(startIdx);
  const { swingHigh, swingLow } = findSwingHighsLows(slice, PIVOT_LEN);

  const pivotHighs: PivotPoint[] = [];
  const pivotLows: PivotPoint[] = [];
  for (let i = 0; i < slice.length; i++) {
    if (swingHigh[i]) {
      pivotHighs.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].high });
    }
    if (swingLow[i]) {
      pivotLows.push({ idx: startIdx + i, t: slice[i].time, p: slice[i].low });
    }
  }

  if (pivotHighs.length < 2 || pivotLows.length < 2) {
    setDebugState("__TR_DBG", {
      stage: "insufficient_pivots",
      pivotHighs: pivotHighs.length,
      pivotLows: pivotLows.length,
      at: candles4h.at(-1)?.time,
    });
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
    setDebugState("__TR_DBG", {
      stage: "mixed_or_range",
      detail: "both true (unexpected)",
      ...structExtra,
    });
    return keepIfRange ?? { mode: "none", breakCount: 0, why: "mixed_or_range" };
  }

  if (!isUp && !isDown) {
    setDebugState("__TR_DBG", {
      stage: "mixed_or_range",
      detail: `PH ${hPrev}->${hLast}, PL ${lPrev}->${lLast}`,
      ...structExtra,
    });
    return keepIfRange ?? { mode: "none", breakCount: 0, why: "mixed_or_range" };
  }

  if (isUp) {
    const pair = pickHLPair(pivotLows, atrNow, TREND_MIN_SWING_MULT);
    if (!pair) {
      setDebugState("__TR_DBG", {
        stage: "anchor_fail_up",
        at: candles4h.at(-1)?.time,
      });
      return { mode: "none", breakCount: 0, why: "anchor_fail" };
    }

    const line: Line2P = {
      t1: pair.L1.t,
      p1: pair.L1.p,
      t2: pair.L2.t,
      p2: pair.L2.p,
    };
    return { mode: "up", line, breakCount: 0, anchorStartTime: line.t1 };
  }

  const pair = pickLHPair(pivotHighs, atrNow, TREND_MIN_SWING_MULT);
  if (!pair) {
    setDebugState("__TR_DBG", {
      stage: "anchor_fail_down",
      at: candles4h.at(-1)?.time,
    });
    return { mode: "none", breakCount: 0, why: "anchor_fail" };
  }

  const line: Line2P = {
    t1: pair.H1.t,
    p1: pair.H1.p,
    t2: pair.H2.t,
    p2: pair.H2.p,
  };
  return { mode: "down", line, breakCount: 0, anchorStartTime: line.t1 };
}

export function updateLockedTrendline(
  prev: TrendlineState,
  candles4h: Candle[]
): TrendlineState {
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

  const breach = prev.mode === "up" ? lineP - c.close : c.close - lineP;
  const validBreach = breach >= atrNow * 0.2;
  const newCount = validBreach ? (prev.breakCount ?? 0) + 1 : 0;

  if (newCount >= 2) {
    return buildTrendlineFromScratch(candles4h, null);
  }

  return { ...prev, breakCount: newCount };
}

function computeStructureSignals(
  candles4h: Candle[],
  atr: number[]
): StructureSignals {
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
    const p = i - PIVOT_LEN;
    if (p >= 0) {
      if (swingHigh[p]) {
        phList.push({ idx: p, t: candles4h[p].time, p: candles4h[p].high });
      }
      if (swingLow[p]) {
        plList.push({ idx: p, t: candles4h[p].time, p: candles4h[p].low });
      }

      if (phList.length >= 2 && plList.length >= 2) {
        const hPrev = phList[phList.length - 2].p;
        const hLast = phList[phList.length - 1].p;
        const lPrev = plList[plList.length - 2].p;
        const lLast = plList[plList.length - 1].p;

        const isUp = hLast > hPrev && lLast > lPrev;
        const isDown = hLast < hPrev && lLast < lPrev;

        if (isUp) {
          structureMode = "up";
          const prevPL = plList.length >= 2 ? plList[plList.length - 2] : null;
          const curPL = plList[plList.length - 1];
          if (prevPL && curPL.p > prevPL.p) lastHL = curPL;
        } else if (isDown) {
          structureMode = "down";
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

    if (structureMode === "up" && lastHL) {
      if (prevClose >= lastHL.p && candles4h[i].close < lastHL.p) chochDown[i] = true;
    }
    if (structureMode === "down" && lastLH) {
      if (prevClose <= lastLH.p && candles4h[i].close > lastLH.p) chochUp[i] = true;
    }

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

      const upTargets: number[] = [];
      if (eqh != null) upTargets.push(eqh);
      if (lastPH1) upTargets.push(lastPH1.p);

      for (const lvl of upTargets) {
        if (sweepBar.high > lvl && recBar.close < lvl) {
          sweepUp[i] = true;
          break;
        }
      }

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

export function computeAPlusOBAndAFVG(
  candles4h: Candle[],
  channel: ChannelState,
  trend: TrendlineState
): Zone[] {
  const n = candles4h.length;
  if (n < 120) return [];

  const atr = computeATR(candles4h, 14);
  const sig = computeStructureSignals(candles4h, atr);
  const zones: Zone[] = [];

  setDebugState("__CTX", {
    calls: 0,
    pass: 0,
    fail: 0,
    reasons: {},
    last: null,
    ts: Date.now(),
  });

  for (let k = 0; k < n; k++) {
    const bullImpulse = sig.bosUp[k] || sig.chochUp[k];
    const bearImpulse = sig.bosDown[k] || sig.chochDown[k];
    if (!bullImpulse && !bearImpulse) continue;

    const side: "bull" | "bear" = bullImpulse ? "bull" : "bear";
    const atrK = Number.isFinite(atr[k]) ? atr[k] : NaN;
    if (!Number.isFinite(atrK) || atrK <= 0) continue;

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
    const top = side === "bull" ? ob.open : ob.high;
    const bottom = side === "bull" ? ob.low : ob.open;
    const mid = (top + bottom) / 2;

    if (!passesContextDistance(side, mid, ob.time, atrK, channel, trend, top, bottom)) {
      continue;
    }

    let touchCount = 0;
    let invBreakCount = 0;
    let active = true;
    let invalidReason: ZoneInvalidReason | undefined;
    let endTime: ChartUnixTime | undefined;
    let inTouch = false;

    for (let i = obIdx + 1; i < n; i++) {
      const c = candles4h[i];
      const ai = Number.isFinite(atr[i]) ? atr[i] : atrK;
      if (!Number.isFinite(ai) || ai <= 0) continue;

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
        touchCount += 1;
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

  for (let i = 1; i < n - 1; i++) {
    const cPrev = candles4h[i - 1];
    const cMid = candles4h[i];
    const cNext = candles4h[i + 1];

    const atrI = Number.isFinite(atr[i]) ? atr[i] : NaN;
    if (!Number.isFinite(atrI) || atrI <= 0) continue;

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

    const conf = i + 1;
    if (conf >= n) continue;

    const confTime = candles4h[conf].time;
    const atrConf = Number.isFinite(atr[conf]) ? atr[conf] : atrI;
    const midPrice = (top + bottom) / 2;

    const b1 = Math.abs(cPrev.close - cPrev.open);
    const b2 = Math.abs(cMid.close - cMid.open);
    const b3 = Math.abs(cNext.close - cNext.open);
    const maxBody = Math.max(b1, b2, b3);
    const sumBody = b1 + b2 + b3;
    const f1 = maxBody > atrI * 1.0 || sumBody > atrI * 1.8;
    if (!f1) continue;

    const w0 = Math.max(0, conf - 3);
    const w1 = Math.min(n - 1, conf + 3);

    let f2 = false;
    for (let k = w0; k <= w1; k++) {
      if (side === "bull" && (sig.bosUp[k] || sig.chochUp[k])) {
        f2 = true;
        break;
      }
      if (side === "bear" && (sig.bosDown[k] || sig.chochDown[k])) {
        f2 = true;
        break;
      }
    }

    let f3 = false;
    for (let k = w0; k <= w1; k++) {
      if (side === "bull" && sig.sweepDown[k]) {
        f3 = true;
        break;
      }
      if (side === "bear" && sig.sweepUp[k]) {
        f3 = true;
        break;
      }
    }

    const f4 = passesContextDistance(
      side,
      midPrice,
      confTime,
      atrConf,
      channel,
      trend,
      top,
      bottom
    );

    const extra = (f2 ? 1 : 0) + (f3 ? 1 : 0) + (f4 ? 1 : 0);
    if (extra < 2) continue;

    let touchCount = 0;
    let active = true;
    let invalidReason: ZoneInvalidReason | undefined;
    let endTime: ChartUnixTime | undefined;
    let inTouch = false;

    for (let j = conf + 1; j < n; j++) {
      const c = candles4h[j];

      const fullFilled =
        side === "bull"
          ? c.low <= bottom
          : c.high >= top;

      if (fullFilled) {
        active = false;
        invalidReason = "fullfill";
        endTime = to4hCloseTime(c.time);
        break;
      }

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

      const overlaps = c.low <= top && c.high >= bottom;
      if (!overlaps) {
        inTouch = false;
        continue;
      }

      if (!inTouch) {
        touchCount += 1;
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

  const dedupeMap = new Map<string, Zone>();
  for (const z of zones) {
    const key =
      `${z.kind}|${z.side}|${z.startTime}|` +
      `${Math.round(z.top * 100)}|${Math.round(z.bottom * 100)}`;

    const prev = dedupeMap.get(key);
    if (!prev) {
      dedupeMap.set(key, z);
    } else if (!prev.active && z.active) {
      dedupeMap.set(key, z);
    }
  }

  const deduped = Array.from(dedupeMap.values());
  return deduped.length > MAX_ZONES
    ? deduped.slice(deduped.length - MAX_ZONES)
    : deduped;
}
