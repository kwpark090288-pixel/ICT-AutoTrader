import "dotenv/config";
import { createHash } from "node:crypto";
import WebSocket from "ws";

import { getOrInitEngine } from "../lib/engine/runtime";
import { intervalToTF, tfDurationMs } from "../lib/engine/binance";
import { toIsoUtc } from "../lib/engine/time";
import { dumpTickSizeCache, getCachedTickSize, preloadTickSizes } from "../lib/engine/ticksize";
import { dumpPriceBasisLock } from "../lib/engine/price-basis";
import { resolveRuntimeInvalidationTime } from "../lib/engine/runtime-poi-store";
import { appendMarketBar, getMarketBarAtCloseTime } from "../lib/engine/market-context";
import { upsertBookTicker } from "../lib/engine/book-ticker";
import { appendSignalEvents } from "../lib/engine/event-sink";
import { appendStoredSignalEventToDb } from "../lib/engine/event-sink";
import {
  bufferOrReleaseRouterCandidateEvaluationItem,
  releaseRouterCandidateEvaluationBatchForM5,
  type RouterCandidateEvaluationItem,
} from "../lib/router/close-sync";
import { buildRouterRawSignalCandidatesForBar } from "../lib/router/runtime";
import {
  buildDbBackedRuntimePolicyResultFromSeed,
  buildRuntimeRouterCandidate,
  getRuntimePreviousM5CloseTimeIso,
} from "../lib/router/runtime-open";
import {
  coalesceRouterCycleCandidates,
  filterRouterCycleSendOpenCandidates,
  hasActiveTradeKey,
} from "../lib/router/candidate";
import {
  buildRouterSendClosePayload,
  buildRouterSendOpenPayload,
  getRouterCloseSeverity,
  hasRequiredRouterSendClosePayloadFields,
  hasRequiredRouterSendOpenPayloadFields,
} from "../lib/router/contracts";
import { selectBest1OpenCandidate } from "../lib/router/selection";
import { evaluateTradeOpenSuppression } from "../lib/tradelifecycle/intake";
import { evaluateTradeOpen } from "../lib/tradelifecycle/open";
import { applyTradeMonitorOnBar } from "../lib/tradelifecycle/monitor";
import { finalizeClosedTradeReview } from "../lib/tradelifecycle/review";
import {
  buildTradeReplayNote,
  formatTradePlanCloseEvent,
  formatTradePlanOpenEvent,
  formatTradePlanSuppressEvent,
} from "../lib/tradelifecycle/closeOutput";
import {
  listRuntimeActiveTradeKeyRefs,
  listRuntimeActiveTradePlanRefs,
  hydrateRuntimeOpenedTrade,
  listRuntimeOpenedTradeRecords,
  registerRuntimeOpenedTrade,
  updateRuntimeTradePlan,
} from "../lib/tradelifecycle/runtime-store";
import { upsertPersistedTradePlanRecord, listPersistedRuntimeOpenTradeRecords } from "../lib/tradelifecycle/persistence";
import {
  insertConcentrationHistoryOnSendOpen,
  syncPolicyAccountStateAfterClose,
  updateEdgeStatsFromClosedTradePlan,
  upsertPolicyDecisionLog,
} from "../lib/policy/runtime-state";
import {
  dispatchDueTelegramOutboxOnce,
  evaluateTelegramDispatchReadiness,
  enqueueTelegramTradeClose,
  enqueueTelegramTradeOpen,
  loadTelegramDispatchConfig,
} from "../lib/telegram/outbox";
import {
  getSendOpenBlockReason,
  isSendOpenBlocked,
} from "../lib/engine/send-open-guard";
import type {
  StoredSignalEvent,
  StoredSignalPoiHighlight,
} from "../lib/alerts/types";
import type { Bar } from "../lib/engine/types";
import type { TradePlan } from "../lib/tradelifecycle/types";
import type { RouterRawPoi } from "../lib/router/raw-event";

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
      v: string;
      x: boolean; // candle closed
    };
  };
};

type WsCombinedBookTickerMessage = {
  stream: string;
  data?: {
    e?: "bookTicker";
    E?: number;
    T?: number;
    s?: string;
    b?: string;
    a?: string;
  };
};

type WsCombinedStreamMessage = WsCombinedKlineMessage | WsCombinedBookTickerMessage;

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
const TELEGRAM_DISPATCH_POLL_MS = Number(
  process.env.TELEGRAM_DISPATCH_POLL_MS || 15000
);

const TEST_FORCE_WS_CLOSE_ONCE =
  String(process.env.TEST_FORCE_WS_CLOSE_ONCE || "").toLowerCase() === "true";

const TEST_FORCE_WS_CLOSE_AFTER_MS = Number(
  process.env.TEST_FORCE_WS_CLOSE_AFTER_MS || 15000
);
const RECOVERY_BATCH_SETTLE_MS = Number(
  process.env.RECOVERY_BATCH_SETTLE_MS || 3000
);

const lastClosedBarCloseTime = new Map<string, number>();

type RecoveryGapTarget = {
  symbol: string;
  tf: TfKey;
  previousCloseTime: number;
  targetCloseTime: number;
  coveredUntil: number;
};

type ReplayItem = {
  symbol: string;
  bar: Bar;
};

const pendingReplayBars = new Map<string, Bar[]>();
const pendingLiveBarsDuringReplay = new Map<string, ReplayItem>();
const recoveryGapTargets = new Map<string, RecoveryGapTarget>();
const inFlightGapFetches = new Set<string>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let telegramDispatchTimer: ReturnType<typeof setInterval> | null = null;
let hasForcedWsClose = false;
let telegramDispatchInFlight = false;
let recoveryBatchSeq = 0;
let activeRecoveryBatchId: number | null = null;
let queuedRecoveryBatchFinalizeId: number | null = null;
let recoveryBatchFinalizeTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryBatchLastActivityAtMs = 0;
const consumedChannelEntryPoiIds = new Set<string>();
const warnedMissingInvalidationRefs = new Set<string>();
let wsBarProcessingChain: Promise<void> = Promise.resolve();

function filterSuppressedChannelEntryRawEvents(
  rawEvents: readonly string[]
): string[] {
  return rawEvents.filter((rawEvent) => {
    if (!rawEvent.startsWith("[ENTRY_WINDOW_OPEN]")) {
      return true;
    }

    const poiMatch = rawEvent.match(/\bpoi=([^\s]+)/);
    if (!poiMatch) {
      return true;
    }

    return !consumedChannelEntryPoiIds.has(poiMatch[1]);
  });
}

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

function resolveStoredSignalPoiHighlight(
  poiSnapshot: RouterRawPoi | null | undefined
): StoredSignalPoiHighlight | undefined {
  if (!poiSnapshot || !("highlight" in poiSnapshot) || !poiSnapshot.highlight) {
    return undefined;
  }

  return poiSnapshot.highlight;
}

function buildStoredSendOpenEvent(
  plan: TradePlan,
  poiHighlight?: StoredSignalPoiHighlight
): StoredSignalEvent {
  return {
    id: plan.planId,
    type: "SEND_OPEN",
    symbol: plan.symbol,
    tf: plan.tf,
    time: plan.openTime,
    direction: plan.dir,
    planId: plan.planId,
    poiRef: plan.poiId,
    entryRefPrice: plan.entryRefPrice,
    stopPrice: plan.stopPrice,
    tpPrice: plan.tpPrice,
    rrChosen: plan.rrChosen,
    tpMode: plan.tpMode,
    entryQuality: plan.entryQuality,
    poiTier: plan.poiTier,
    collabStrength: plan.collabStrength,
    policyState: plan.policySnapshot?.regimeState,
    score: plan.score,
    poiHighlight,
  };
}

function buildStoredSendCloseEvent(
  plan: TradePlan,
  poiHighlight?: StoredSignalPoiHighlight
): StoredSignalEvent {
  return {
    id: `${plan.planId}|CLOSE`,
    type: "SEND_CLOSE",
    symbol: plan.symbol,
    tf: plan.tf,
    time: plan.closeTime as string,
    exitTime: plan.closeTime,
    direction: plan.dir,
    planId: plan.planId,
    poiRef: plan.poiId,
    outcome: plan.outcome,
    exitPrice: plan.exitPrice,
    rGross: plan.rGross,
    mfeR: plan.mfeR,
    maeR: plan.maeR,
    bothHit: plan.bothHit,
    weaknessCodes: plan.weaknessCodes,
    replayNote: buildTradeReplayNote(plan) ?? undefined,
    policyState: plan.policySnapshot?.regimeState,
    entryQuality: plan.entryQuality,
    collabStrength: plan.collabStrength,
    score: plan.score,
    severity: Number.isFinite(plan.score) ? getRouterCloseSeverity(plan.score) : undefined,
    poiHighlight,
  };
}

async function flushTelegramOutbox(reason: string): Promise<void> {
  if (telegramDispatchInFlight) {
    return;
  }

  telegramDispatchInFlight = true;

  try {
    const summary = await dispatchDueTelegramOutboxOnce();

    if (
      summary.attempted > 0 ||
      summary.sent > 0 ||
      summary.failed > 0 ||
      summary.skippedReason
    ) {
      log("[TELEGRAM_DISPATCH]", {
        reason,
        ...summary,
      });
    }
  } catch (error) {
    log("[TELEGRAM_DISPATCH_ERROR]", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    telegramDispatchInFlight = false;
  }
}

function startTelegramDispatchLoop(): void {
  if (telegramDispatchTimer) {
    return;
  }

  telegramDispatchTimer = setInterval(() => {
    void flushTelegramOutbox("poll");
  }, TELEGRAM_DISPATCH_POLL_MS);

  void flushTelegramOutbox("startup");
}

function streamName(symbol: string, interval: string): string {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

function bookTickerStreamName(symbol: string): string {
  return `${symbol.toLowerCase()}@bookTicker`;
}

function intervalFromStream(stream: string): string | null {
  const token = "@kline_";
  const idx = stream.indexOf(token);
  if (idx === -1) return null;
  return stream.slice(idx + token.length);
}

function hasCommittedSameCloseTimeM5(symbol: string, closeTime: number): boolean {
  return Boolean(getMarketBarAtCloseTime(symbol, "M5", closeTime));
}

function isBookTickerStream(stream: string): boolean {
  return stream.endsWith("@bookTicker");
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

function replayItemKey(symbol: string, tf: TfKey, closeTime: number): string {
  return `${barKey(symbol, tf)}:${closeTime}`;
}

function ensureGapRecoveryBatchActive(): number {
  if (activeRecoveryBatchId !== null) {
    return activeRecoveryBatchId;
  }

  activeRecoveryBatchId = ++recoveryBatchSeq;
  queuedRecoveryBatchFinalizeId = null;
  recoveryBatchLastActivityAtMs = Date.now();
  setRuntimeSyncing("GAP_REPLAY", { gapDetected: true });
  log("[RECOVERY_BATCH_START]", {
    batchId: activeRecoveryBatchId,
  });
  return activeRecoveryBatchId;
}

function markRecoveryBatchActivity(): void {
  recoveryBatchLastActivityAtMs = Date.now();
  queuedRecoveryBatchFinalizeId = null;
  if (recoveryBatchFinalizeTimer) {
    clearTimeout(recoveryBatchFinalizeTimer);
    recoveryBatchFinalizeTimer = null;
  }
}

function clearGapRecoveryBatchState(): void {
  activeRecoveryBatchId = null;
  queuedRecoveryBatchFinalizeId = null;
  recoveryBatchLastActivityAtMs = 0;
  if (recoveryBatchFinalizeTimer) {
    clearTimeout(recoveryBatchFinalizeTimer);
    recoveryBatchFinalizeTimer = null;
  }
  pendingReplayBars.clear();
  pendingLiveBarsDuringReplay.clear();
  recoveryGapTargets.clear();
  inFlightGapFetches.clear();
}

function resolveGapAgainstLastCommitted(
  symbol: string,
  tf: TfKey,
  closeTime: number
): { previousCloseTime: number; expectedCloseTime: number } | null {
  const prev = lastClosedBarCloseTime.get(barKey(symbol, tf));
  if (!Number.isFinite(prev)) {
    return null;
  }

  const expected = (prev as number) + tfDurationMs(tf);
  if (closeTime <= expected) {
    return null;
  }

  return {
    previousCloseTime: prev as number,
    expectedCloseTime: expected,
  };
}

function appendReplayBarsForKey(key: string, bars: readonly Bar[]): void {
  if (!bars.length) {
    return;
  }

  const existing = pendingReplayBars.get(key) ?? [];
  const merged = new Map<number, Bar>();

  for (const bar of existing) {
    merged.set(bar.closeTime, bar);
  }
  for (const bar of bars) {
    merged.set(bar.closeTime, bar);
  }

  pendingReplayBars.set(
    key,
    [...merged.values()].sort((a, b) => a.closeTime - b.closeTime)
  );
}

function bufferLiveBarDuringRecovery(symbol: string, bar: Bar): void {
  const tf = bar.tf as TfKey;
  const key = replayItemKey(symbol, tf, bar.closeTime);
  if (!pendingLiveBarsDuringReplay.has(key)) {
    markRecoveryBatchActivity();
    pendingLiveBarsDuringReplay.set(key, {
      symbol,
      bar,
    });
    log("[RECOVERY_BATCH_BUFFER_LIVE]", {
      batchId: activeRecoveryBatchId,
      symbol,
      tf,
      closeTime: toIsoUtc(bar.closeTime),
    });
  }

  registerGapTargetForRecoveryBatch(symbol, tf, bar.closeTime);
  drainPendingReplayBarsIfReady();
}

function registerGapTargetForRecoveryBatch(
  symbol: string,
  tf: TfKey,
  closeTime: number
): boolean {
  const gap = resolveGapAgainstLastCommitted(symbol, tf, closeTime);
  if (!gap) {
    return false;
  }

  const batchId = ensureGapRecoveryBatchActive();
  const key = barKey(symbol, tf);
  const existing = recoveryGapTargets.get(key);

  if (!existing) {
    markRecoveryBatchActivity();
    recoveryGapTargets.set(key, {
      symbol,
      tf,
      previousCloseTime: gap.previousCloseTime,
      targetCloseTime: closeTime,
      coveredUntil: gap.previousCloseTime,
    });
    log("[GAP_DETECTED]", {
      batchId,
      symbol,
      tf,
      previousCloseTime: toIsoUtc(gap.previousCloseTime),
      expectedCloseTime: toIsoUtc(gap.expectedCloseTime),
      actualCloseTime: toIsoUtc(closeTime),
    });
  } else if (closeTime > existing.targetCloseTime) {
    markRecoveryBatchActivity();
    existing.targetCloseTime = closeTime;
    log("[RECOVERY_BATCH_REGISTER_GAP]", {
      batchId,
      symbol,
      tf,
      previousCloseTime: toIsoUtc(existing.previousCloseTime),
      nextTargetCloseTime: toIsoUtc(existing.targetCloseTime),
    });
  }

  pumpGapFetchesForRecoveryBatch();
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
  const volume = Number(k.v);

  if (![open, high, low, close, volume].every(Number.isFinite)) return null;

  return {
    tf,
    openTime: k.t,
    closeTime: k.T ?? k.t + tfDurationMs(tf),
    open,
    high,
    low,
    close,
    volume,
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
        v: r[5],
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

    appendReplayBarsForKey(key, replayBars);

    const target = recoveryGapTargets.get(key);
    if (target) {
      const coveredUntil = replayBars.length
        ? replayBars[replayBars.length - 1].closeTime
        : actualCloseTime;
      target.coveredUntil = Math.max(target.coveredUntil, coveredUntil);
    }

    log("[GAP_FETCHED]", {
      batchId: activeRecoveryBatchId,
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
    const target = recoveryGapTargets.get(key);
    if (target) {
      target.coveredUntil = Math.max(target.coveredUntil, actualCloseTime);
    }
    log("[GAP_FETCH_ERROR]", {
      batchId: activeRecoveryBatchId,
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

async function injectBarsDeterministically(
  items: ReplayItem[],
  source: "bootstrap" | "gap" | "restart"
): Promise<void> {
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

    appendMarketBar(symbol, item.bar);

    const engine = getOrInitEngine(symbol);
    const evs = engine.onBarClose(item.bar);

    rememberClosedBar(symbol, tf, item.bar.closeTime);

    if (evs.length) {
      console.log(evs.join("\n"));
    }

    await processRuntimeTradeMonitorBar(symbol, item.bar);
  }

  log("[REPLAY_APPLY_DONE]", {
    source,
    count: sorted.length,
    digest,
  });
}

function pumpGapFetchesForRecoveryBatch(): void {
  if (activeRecoveryBatchId === null) {
    return;
  }

  for (const target of recoveryGapTargets.values()) {
    const key = barKey(target.symbol, target.tf);
    if (inFlightGapFetches.has(key)) {
      continue;
    }

    if (target.coveredUntil >= target.targetCloseTime) {
      continue;
    }

    void fetchGapBars(
      target.symbol,
      target.tf,
      target.coveredUntil,
      target.targetCloseTime
    );
  }
}

function buildRecoveryBatchReplayItems(): ReplayItem[] {
  const items: ReplayItem[] = [];
  const replayCoveredKeys = new Set<string>();

  for (const [key, bars] of pendingReplayBars.entries()) {
    const [symbolRaw, tfRaw] = key.split(":");
    const symbol = symbolRaw?.toUpperCase();
    const tf = tfRaw as TfKey | undefined;
    if (!symbol || !tf) {
      continue;
    }

    for (const bar of bars) {
      items.push({ symbol, bar });
      replayCoveredKeys.add(replayItemKey(symbol, tf, bar.closeTime));
    }
  }

  for (const [key, item] of pendingLiveBarsDuringReplay.entries()) {
    if (replayCoveredKeys.has(key)) {
      log("[RECOVERY_BATCH_DROP_DUP]", {
        batchId: activeRecoveryBatchId,
        symbol: item.symbol,
        tf: item.bar.tf,
        closeTime: toIsoUtc(item.bar.closeTime),
      });
      continue;
    }

    items.push(item);
  }

  return items.sort(compareReplayItems);
}

function processRouterCandidateEvaluationItem(
  item: RouterCandidateEvaluationItem
): void {
  const { symbol, bar } = item;
  const rawEvents = filterSuppressedChannelEntryRawEvents(item.rawEvents);
  const tf = bar.tf as TfKey;

  if (!rawEvents.length) {
    return;
  }

  console.log(rawEvents.join("\n"));

  const rawSeeds = buildRouterRawSignalCandidatesForBar({
    symbol,
    bar,
    rawEvents,
  });

  if (rawSeeds.length) {
    log("[ROUTER_RAW_SEEDS]", {
      symbol,
      tf,
      count: rawSeeds.length,
      candidateIds: rawSeeds.map((seed) => seed.candidateId),
    });
  }

  void appendSignalEvents({
    symbol,
    tf: String(bar.tf),
    eventTexts: [...rawEvents],
  });
}

function emitTradePlanSuppressEvent(args: {
  symbol: string;
  tf: string;
  openTime: string;
  reason:
    | "DUPLICATE"
    | "POLICY_MISSING"
    | "HALT_OR_BLOCK"
    | "LATE_LOW_CONV"
    | "INVALID_INPUT"
    | "DATA_GAP"
    | "DEDUP_ZONE";
  dir: "LONG" | "SHORT";
  poiId: string;
}): void {
  const line = formatTradePlanSuppressEvent({
    openTime: args.openTime,
    reason: args.reason,
    symbol: args.symbol,
    dir: args.dir,
    poiId: args.poiId,
  });

  console.log(line);
  void appendSignalEvents({
    symbol: args.symbol,
    tf: args.tf,
    eventTexts: [line],
  });
}

async function processRouterCandidateEvaluationBatch(
  items: readonly RouterCandidateEvaluationItem[]
): Promise<void> {
  if (!items.length) {
    return;
  }

  const rawSeeds = items.flatMap((item) => {
    const filteredRawEvents = filterSuppressedChannelEntryRawEvents(item.rawEvents);
    const filteredItem =
      filteredRawEvents.length === item.rawEvents.length
        ? item
        : { ...item, rawEvents: filteredRawEvents };

    processRouterCandidateEvaluationItem(filteredItem);

    const seeds = buildRouterRawSignalCandidatesForBar({
      symbol: filteredItem.symbol,
      bar: filteredItem.bar,
      rawEvents: filteredItem.rawEvents,
    });

    if (seeds.length) {
      log("[ROUTER_RAW_SEEDS]", {
        symbol: filteredItem.symbol,
        tf: filteredItem.bar.tf,
        count: seeds.length,
        candidateIds: seeds.map((seed) => seed.candidateId),
      });
    }

    return seeds.filter(
      (seed) =>
        !(
          seed.poiKind === "CHANNEL" &&
          seed.eventName === "ENTRY_WINDOW_OPEN" &&
          consumedChannelEntryPoiIds.has(seed.poiId)
        )
    );
  });

  if (!rawSeeds.length) {
    return;
  }

  const syncState = getRuntimeStateSnapshot();
  const evaluated = (
    await Promise.all(
      rawSeeds.map((seed) =>
        buildDbBackedRuntimePolicyResultFromSeed({
          seed,
          syncState,
        })
      )
    )
  )
    .filter((value) => value !== null);

  if (evaluated.length) {
    await Promise.all(
      evaluated.map((item) =>
        upsertPolicyDecisionLog({
          signal: item.signal,
          policy: item.policy,
        })
      )
    );
  }

  const coalescedSignals = coalesceRouterCycleCandidates(
    evaluated.map((item) => item.signal)
  );
  const activeTradeKeyRefs = listRuntimeActiveTradeKeyRefs();

  for (const signal of coalescedSignals) {
    if (!signal.tradeKey || !hasActiveTradeKey(signal.tradeKey, activeTradeKeyRefs)) {
      continue;
    }

    emitTradePlanSuppressEvent({
      symbol: signal.symbol,
      tf: signal.ltf ?? "M5",
      openTime: signal.time,
      reason: "DUPLICATE",
      dir: signal.dir === "BULL" ? "LONG" : "SHORT",
      poiId: signal.poiId,
    });
  }

  const sendOpenCandidates = filterRouterCycleSendOpenCandidates(
    coalescedSignals,
    activeTradeKeyRefs
  );

  if (!sendOpenCandidates.length) {
    return;
  }

  const evaluatedByCandidateId = new Map(
    evaluated
      .filter((item) => item.signal.candidateId)
      .map((item) => [item.signal.candidateId as string, item] as const)
  );

  const routerCandidates = sendOpenCandidates
    .map((signal) => {
      const candidateId = signal.candidateId;
      if (!candidateId) {
        return null;
      }

      const evaluatedItem = evaluatedByCandidateId.get(candidateId);
      if (!evaluatedItem) {
        return null;
      }

      return buildRuntimeRouterCandidate({
        seed: evaluatedItem.seed,
        signal: evaluatedItem.signal,
        policy: evaluatedItem.policy,
        emissionBar: {
          high: evaluatedItem.seed.barSnapshot?.high ?? Number.NaN,
          low: evaluatedItem.seed.barSnapshot?.low ?? Number.NaN,
        },
      });
    })
    .filter((candidate) => candidate !== null);

  const best = selectBest1OpenCandidate(routerCandidates);
  if (!best) {
    return;
  }

  const payload = buildRouterSendOpenPayload(best);
  if (!hasRequiredRouterSendOpenPayloadFields(payload)) {
    emitTradePlanSuppressEvent({
      symbol: best.signal.symbol,
      tf: best.tf,
      openTime: best.signal.time,
      reason: "INVALID_INPUT",
      dir: best.signal.dir === "BULL" ? "LONG" : "SHORT",
      poiId: best.signal.poiId,
    });
    return;
  }

  const tickSize = Number.isFinite(best.signal.tickSize)
    ? best.signal.tickSize
    : getCachedTickSize(best.signal.symbol);

  if (!Number.isFinite(tickSize) || (tickSize as number) <= 0) {
    emitTradePlanSuppressEvent({
      symbol: best.signal.symbol,
      tf: best.tf,
      openTime: best.signal.time,
      reason: "INVALID_INPUT",
      dir: best.signal.dir === "BULL" ? "LONG" : "SHORT",
      poiId: best.signal.poiId,
    });
    return;
  }

  const suppression = evaluateTradeOpenSuppression({
    payload,
    tickSize: tickSize as number,
    prevM5CloseTime: getRuntimePreviousM5CloseTimeIso(best.signal.symbol, best.signal.time),
    currM5CloseTime: best.signal.time,
    activePlans: listRuntimeActiveTradePlanRefs(),
  });

  if (suppression.decision === "SUPPRESS") {
    emitTradePlanSuppressEvent({
      symbol: payload.intent.symbol,
      tf: payload.intent.tf,
      openTime: payload.intent.openTime,
      reason: suppression.reason as "INVALID_INPUT" | "DATA_GAP" | "DEDUP_ZONE",
      dir: payload.intent.dir,
      poiId: payload.intent.poiId,
    });
    return;
  }

  const bestEvaluated = best.signal.candidateId
    ? evaluatedByCandidateId.get(best.signal.candidateId)
    : null;

  if (!bestEvaluated) {
    return;
  }

  const openEval = evaluateTradeOpen({
    payload,
    signalBarClose: best.signal.lastPrice,
    tickSize: tickSize as number,
    atrM5_14_atOpen: best.signal.ltAtr14,
    atrLiq_14_atOpen: bestEvaluated.atrLiq14AtOpen,
    confirmedTpPivots: bestEvaluated.confirmedTpPivots,
  });

  if (!openEval || openEval.decision !== "OPEN" || !openEval.plan) {
    emitTradePlanSuppressEvent({
      symbol: payload.intent.symbol,
      tf: payload.intent.tf,
      openTime: payload.intent.openTime,
      reason: (openEval?.reason ?? "INVALID_INPUT") as
        | "POLICY_MISSING"
        | "HALT_OR_BLOCK"
        | "LATE_LOW_CONV"
        | "INVALID_INPUT",
      dir: payload.intent.dir,
      poiId: payload.intent.poiId,
    });
    return;
  }

  const openedPlan = openEval.plan;
  const tradeKey = best.signal.tradeKey ?? payload.planKey;
  const poiHighlight = resolveStoredSignalPoiHighlight(
    bestEvaluated.seed.poiSnapshot
  );

  if (
    bestEvaluated.seed.poiKind === "CHANNEL" &&
    bestEvaluated.seed.eventName === "ENTRY_WINDOW_OPEN"
  ) {
    consumedChannelEntryPoiIds.add(bestEvaluated.seed.poiId);
  }

  await upsertPersistedTradePlanRecord({
    tradeKey,
    zoneKey: suppression.zoneKey,
    plan: openedPlan,
    poiClusterKey: best.policy.derived.poiClusterKey,
    poiHighlight,
  });

  registerRuntimeOpenedTrade({
    tradeKey,
    zoneKey: suppression.zoneKey,
    plan: openedPlan,
    poiClusterKey: best.policy.derived.poiClusterKey,
    poiHighlight,
  });

  if (best.signal.candidateId && best.policy.derived.poiClusterKey) {
    await insertConcentrationHistoryOnSendOpen({
      candidateId: best.signal.candidateId,
      tradeKey,
      symbol: openedPlan.symbol,
      dir: best.signal.dir,
      clusterKey: best.policy.derived.poiClusterKey,
      source: best.signal.source,
      poiTier: best.signal.poiTier,
      openTimeUtc: openedPlan.openTime,
    });
  }

  const openLine = formatTradePlanOpenEvent(openedPlan);
  console.log(openLine);

  void appendSignalEvents({
    symbol: openedPlan.symbol,
    tf: openedPlan.tf,
    eventTexts: [openLine],
  });

  log("[SEND_OPEN_EMIT]", {
    symbol: openedPlan.symbol,
    tf: openedPlan.tf,
    planId: openedPlan.planId,
    planKey: openedPlan.planKey,
    source: openedPlan.source,
    eventType: openedPlan.eventType,
  });

  void appendStoredSignalEventToDb(
    buildStoredSendOpenEvent(openedPlan, poiHighlight)
  );

  void enqueueTelegramTradeOpen(openedPlan)
    .then(() => flushTelegramOutbox("send_open"))
    .catch((error) => {
      log("[TELEGRAM_ENQUEUE_OPEN_ERROR]", {
        symbol: openedPlan.symbol,
        planId: openedPlan.planId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

async function processRuntimeTradeMonitorBar(symbol: string, bar: Bar): Promise<void> {
  if (bar.tf !== "M5") {
    return;
  }

  const tickSize = getCachedTickSize(symbol);
  if (!Number.isFinite(tickSize) || (tickSize as number) <= 0) {
    log("[SEND_CLOSE_MISSING_TICKSIZE]", {
      symbol,
      closeTime: toIsoUtc(bar.closeTime),
    });
    return;
  }

  for (const record of listRuntimeOpenedTradeRecords(symbol)) {
    const invalidationLookup = resolveRuntimeInvalidationTime({
      symbol,
      invalidationRef: record.plan.invalidationRef,
    });

    if (invalidationLookup.lookupMissing) {
      const warningKey = `${record.plan.planId}|${record.plan.invalidationRef.source}|${record.plan.invalidationRef.refId}`;
      if (!warnedMissingInvalidationRefs.has(warningKey)) {
        warnedMissingInvalidationRefs.add(warningKey);
        log("[TRADE_INVALIDATION_REF_MISSING]", {
          symbol,
          planId: record.plan.planId,
          source: record.plan.invalidationRef.source,
          refId: record.plan.invalidationRef.refId,
        });
      }
    }

    const monitoredPlan = applyTradeMonitorOnBar({
      plan: record.plan,
      bar,
      tickSize: tickSize as number,
      invalidTime: invalidationLookup.invalidTime,
    });

    updateRuntimeTradePlan(monitoredPlan);

    const progressChanged =
      monitoredPlan.status !== record.plan.status ||
      monitoredPlan.mfeR !== record.plan.mfeR ||
      monitoredPlan.maeR !== record.plan.maeR;

    if (progressChanged && monitoredPlan.status !== "CLOSED") {
      await upsertPersistedTradePlanRecord({
        tradeKey: record.tradeKey,
        zoneKey: record.zoneKey,
        plan: monitoredPlan,
        poiClusterKey: record.poiClusterKey,
        poiHighlight: record.poiHighlight,
      });
    }

    if (record.plan.status === "CLOSED" || monitoredPlan.status !== "CLOSED") {
      continue;
    }

    const reviewedPlan = finalizeClosedTradeReview(monitoredPlan);
    updateRuntimeTradePlan(reviewedPlan);
    await upsertPersistedTradePlanRecord({
      tradeKey: record.tradeKey,
      zoneKey: record.zoneKey,
      plan: reviewedPlan,
      poiClusterKey: record.poiClusterKey,
      poiHighlight: record.poiHighlight,
    });
    await updateEdgeStatsFromClosedTradePlan(reviewedPlan);
    if (reviewedPlan.closeTime) {
      await syncPolicyAccountStateAfterClose({
        closeTime: reviewedPlan.closeTime,
      });
    }

    const closePayload = buildRouterSendClosePayload(reviewedPlan);
    if (!hasRequiredRouterSendClosePayloadFields(closePayload)) {
      log("[SEND_CLOSE_INVALID_PAYLOAD]", {
        symbol: reviewedPlan.symbol,
        planId: reviewedPlan.planId,
        outcome: reviewedPlan.outcome ?? null,
      });
      continue;
    }

    const closeLine = formatTradePlanCloseEvent(reviewedPlan);
    console.log(closeLine);

    void appendStoredSignalEventToDb(
      buildStoredSendCloseEvent(reviewedPlan, record.poiHighlight)
    );
    void appendSignalEvents({
      symbol: reviewedPlan.symbol,
      tf: reviewedPlan.tf,
      eventTexts: [closeLine],
    });

    log("[SEND_CLOSE_EMIT]", {
      symbol: reviewedPlan.symbol,
      tf: reviewedPlan.tf,
      planId: reviewedPlan.planId,
      outcome: reviewedPlan.outcome,
      exitPrice: reviewedPlan.exitPrice ?? null,
    });

    void enqueueTelegramTradeClose(reviewedPlan)
      .then(() => flushTelegramOutbox("send_close"))
      .catch((error) => {
        log("[TELEGRAM_ENQUEUE_CLOSE_ERROR]", {
          symbol: reviewedPlan.symbol,
          planId: reviewedPlan.planId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function drainPendingReplayBarsIfReady() {
  if (activeRecoveryBatchId === null) {
    return;
  }

  pumpGapFetchesForRecoveryBatch();

  if (inFlightGapFetches.size > 0) {
    return;
  }

  for (const target of recoveryGapTargets.values()) {
    if (target.coveredUntil < target.targetCloseTime) {
      return;
    }
  }

  if (queuedRecoveryBatchFinalizeId === activeRecoveryBatchId) {
    return;
  }

  const batchId = activeRecoveryBatchId;
  queuedRecoveryBatchFinalizeId = batchId;
  const elapsedSinceLastActivityMs = Date.now() - recoveryBatchLastActivityAtMs;
  const settleDelayMs = Math.max(
    0,
    RECOVERY_BATCH_SETTLE_MS - elapsedSinceLastActivityMs
  );

  recoveryBatchFinalizeTimer = setTimeout(() => {
    recoveryBatchFinalizeTimer = null;
    wsBarProcessingChain = wsBarProcessingChain
      .then(async () => {
        if (activeRecoveryBatchId !== batchId) {
          queuedRecoveryBatchFinalizeId = null;
          return;
        }

        if (Date.now() - recoveryBatchLastActivityAtMs < RECOVERY_BATCH_SETTLE_MS) {
          queuedRecoveryBatchFinalizeId = null;
          drainPendingReplayBarsIfReady();
          return;
        }

        pumpGapFetchesForRecoveryBatch();
        if (inFlightGapFetches.size > 0) {
          queuedRecoveryBatchFinalizeId = null;
          return;
        }

        for (const target of recoveryGapTargets.values()) {
          if (target.coveredUntil < target.targetCloseTime) {
            queuedRecoveryBatchFinalizeId = null;
            return;
          }
        }

        const items = buildRecoveryBatchReplayItems();
        log("[RECOVERY_BATCH_APPLY_START]", {
          batchId,
          replayItemCount: items.length,
        });

        await injectBarsDeterministically(items, "gap");

        log("[RECOVERY_BATCH_APPLY_DONE]", {
          batchId,
          replayItemCount: items.length,
        });

        clearGapRecoveryBatchState();
        setRuntimeSyncOk();
        log("[RECOVERY_BATCH_DONE]", {
          batchId,
        });
      })
      .catch((error) => {
        queuedRecoveryBatchFinalizeId = null;
        log("[REPLAY_APPLY_ERROR]", {
          source: "gap",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, settleDelayMs);
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

  await injectBarsDeterministically(collected, "bootstrap");
  setRuntimeSyncOk();
}

async function hydrateRuntimeTradesFromDb(): Promise<void> {
  const rows = await listPersistedRuntimeOpenTradeRecords();

  for (const row of rows) {
    hydrateRuntimeOpenedTrade({
      tradeKey: row.tradeKey,
      zoneKey: row.zoneKey,
      plan: row.plan,
      poiClusterKey: row.poiClusterKey,
      poiHighlight: row.poiHighlight,
      includeConcentrationHistory: false,
    });
  }

  if (rows.length > 0) {
    log("[RUNTIME_TRADE_STORE_HYDRATED]", {
      count: rows.length,
      planIds: rows.map((row) => row.plan.planId),
    });
  }
}

async function handleClosedKlineStreamMessage(args: {
  interval: string;
  k: NonNullable<NonNullable<WsCombinedKlineMessage["data"]>["k"]>;
}): Promise<void> {
  const bar = makeBarFromKline(args.interval, args.k);
  if (!bar) {
    return;
  }

  const symbol = args.k.s.toUpperCase();
  const tf = bar.tf as TfKey;

  if (isOldOrDuplicateBar(symbol, tf, bar.closeTime)) {
    log("[BAR_IGNORED_DUPLICATE]", {
      symbol,
      tf,
      closeTime: toIsoUtc(bar.closeTime),
    });
    return;
  }

  if (activeRecoveryBatchId !== null) {
    bufferLiveBarDuringRecovery(symbol, bar);
    log("[BAR_BLOCKED_SYNCING]", {
      batchId: activeRecoveryBatchId,
      symbol,
      tf,
      closeTime: toIsoUtc(bar.closeTime),
    });
    return;
  }

  if (registerGapTargetForRecoveryBatch(symbol, tf, bar.closeTime)) {
    bufferLiveBarDuringRecovery(symbol, bar);
    log("[BAR_BLOCKED_SYNCING]", {
      batchId: activeRecoveryBatchId,
      symbol,
      tf,
      closeTime: toIsoUtc(bar.closeTime),
    });
    return;
  }

  appendMarketBar(symbol, bar);

  const engine = getOrInitEngine(symbol);
  const evs = engine.onBarClose(bar);
  rememberClosedBar(symbol, tf, bar.closeTime);

  log("[BAR_CLOSE]", {
    symbol,
    interval: args.interval,
    closeTime: toIsoUtc(bar.closeTime),
  });

  const releasedItems =
    tf === "M5"
      ? releaseRouterCandidateEvaluationBatchForM5(symbol, bar, evs)
      : evs.length > 0
        ? bufferOrReleaseRouterCandidateEvaluationItem(
            {
              symbol,
              bar,
              rawEvents: evs,
            },
            hasCommittedSameCloseTimeM5(symbol, bar.closeTime)
          )
        : [];

  if (tf !== "M5" && evs.length > 0 && releasedItems.length === 0) {
    log("[ROUTER_BATCH_WAIT_M5]", {
      symbol,
      tf,
      closeTime: toIsoUtc(bar.closeTime),
    });
  }

  if (releasedItems.length > 0) {
    await processRouterCandidateEvaluationBatch(releasedItems);
  }

  await processRuntimeTradeMonitorBar(symbol, bar);
}

function startCombinedWs() {
  const streams = WATCHLIST.flatMap((symbol) => [
    ...TF_SET.map((tf) => streamName(symbol, TF_TO_BINANCE[tf])),
    bookTickerStreamName(symbol),
  ]);

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
      const msg = JSON.parse(buf.toString()) as WsCombinedStreamMessage;

      if (isBookTickerStream(msg.stream)) {
        const data = (msg as WsCombinedBookTickerMessage).data;
        const symbol = data?.s?.toUpperCase();
        const bid = Number(data?.b);
        const ask = Number(data?.a);

        if (!symbol || !Number.isFinite(bid) || !Number.isFinite(ask)) {
          return;
        }

        upsertBookTicker({
          symbol,
          bid,
          ask,
          eventTime: Number.isFinite(data?.E) ? data?.E : data?.T,
          recvTime: Date.now(),
        });
        return;
      }

      const interval = intervalFromStream(msg.stream);
      if (!interval) return;

      const klineMsg = msg as WsCombinedKlineMessage;
      const k = klineMsg.data?.k;
      if (!k?.x) return;

      wsBarProcessingChain = wsBarProcessingChain
        .then(() => handleClosedKlineStreamMessage({ interval, k }))
        .catch((error) => {
          log("[WORKER_BAR_PROCESS_ERROR]", {
            interval,
            symbol: k.s?.toUpperCase() ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
        });
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
  const telegramConfig = loadTelegramDispatchConfig();
  const telegramReadiness = evaluateTelegramDispatchReadiness(telegramConfig);

  log("[WORKER_START]", {
    watchlist: WATCHLIST,
    tfSet: TF_SET,
    d1DayKeyTz: D1_DAYKEY_TZ,
  });
  log("[TELEGRAM_READY]", {
    enabled: telegramConfig.enabled,
    hasBotToken: Boolean(telegramConfig.botToken),
    hasChatId: Boolean(telegramConfig.chatId),
    reason: telegramReadiness.reason,
  });

  log("[PRICE_BASIS_LOCK]", dumpPriceBasisLock());

  await preloadTickSizes(WATCHLIST);
  log("[TICKSIZE_READY]", {
    values: dumpTickSizeCache(),
  });

  await hydrateRuntimeTradesFromDb();
  await bootstrapHistory();
  startTelegramDispatchLoop();
  startCombinedWs();
}

main().catch((err) => {
  console.error("[WORKER_FATAL]", err);
  process.exit(1);
});

