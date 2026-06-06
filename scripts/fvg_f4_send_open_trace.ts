import assert from "node:assert/strict";
import { clearBookTickerCache, upsertBookTicker } from "../lib/engine/book-ticker";
import { createFvgIndicatorEngine } from "../lib/engine/indicators/fvg/engine";
import type { ChannelModel } from "../lib/engine/indicators/channel/types";
import { appendMarketBar, clearMarketContext } from "../lib/engine/market-context";
import { clearRuntimePoiStore, listRuntimePois, replaceRuntimeChannelPois } from "../lib/engine/runtime-poi-store";
import { setCachedTickSize } from "../lib/engine/ticksize";
import type { Bar } from "../lib/engine/types";
import { buildRouterRawSignalCandidatesForBar } from "../lib/router/runtime";
import { buildDbBackedRuntimePolicyResultFromSeed, buildRuntimePolicyResultFromSeed, buildRuntimeRouterCandidate } from "../lib/router/runtime-open";
import { buildRouterSendOpenPayload, hasRequiredRouterSendOpenPayloadFields } from "../lib/router/contracts";
import { selectBest1OpenCandidate } from "../lib/router/selection";
import { evaluateTradeOpen } from "../lib/tradelifecycle/open";

const SYMBOL = "F4TRACE";
const TICK = 0.1;
const H4_START = Date.UTC(2026, 2, 18, 0, 0, 0);
const H4_MS = 4 * 60 * 60 * 1000;
const M15_START = Date.UTC(2026, 3, 2, 0, 0, 0);

function buildH4Bars(): Bar[] {
  return Array.from({ length: 17 }, (_, i) => {
    const openTime = H4_START + i * H4_MS;
    const closeTime = openTime + H4_MS - 1000;
    const base: Bar = { tf: "H4", openTime, closeTime, open: 95, high: 100, low: 90, close: 95, volume: 0 };
    const overrides: Record<number, Partial<Bar>> = {
      6: { open: 96, high: 101, low: 93, close: 97 },
      7: { open: 96, high: 98, low: 91, close: 94 },
      8: { open: 94, high: 97, low: 92, close: 93 },
      9: { open: 92, high: 96, low: 88, close: 90 },
      10: { open: 91, high: 96, low: 90, close: 93 },
      11: { open: 95, high: 100, low: 94, close: 95 },
      12: { open: 94, high: 106, low: 94, close: 105 },
      13: { open: 103, high: 108, low: 102, close: 106 },
      14: { open: 105, high: 107, low: 103, close: 105 },
      15: { open: 104, high: 106, low: 102, close: 104 },
      16: { open: 104, high: 106, low: 103, close: 105 },
    };
    return { ...base, ...(overrides[i] ?? {}) };
  });
}

function buildProvider(): ChannelModel {
  const aTime = H4_START + 4 * H4_MS + (H4_MS - 1000);
  const bTime = H4_START + 10 * H4_MS + (H4_MS - 1000);
  const createdAt = H4_START + 13 * H4_MS + (H4_MS - 1000);
  const slope = (100.5 - 99.5) / (bTime - aTime);
  const intercept = 99.5 - slope * aTime;
  return {
    id: `${SYMBOL}:H4_CHANNEL:F4`,
    symbol: SYMBOL,
    type: "H4_CHANNEL",
    tf: "H4",
    state: "ACTIVE",
    mode: "ENABLED",
    geometry: {
      dir: "UP",
      anchorLine: { a: { time: aTime, price: 99.5 }, b: { time: bTime, price: 100.5 }, slope, intercept },
      offset: 5,
      midOffset: 2.5,
    },
    anchorStartTime: aTime,
    anchorEndTime: bTime,
    createdAt,
    lastUpdatedAt: createdAt,
    maxForwardBars: 300,
    displayUntil: createdAt + 300 * H4_MS,
  };
}

function buildBars(tf: "M15" | "M5", count: number, overrides: Record<number, Partial<Bar>>, start: number): Bar[] {
  const durationMs = tf === "M15" ? 15 * 60 * 1000 : 5 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => {
    const openTime = start + i * durationMs;
    const closeTime = openTime + durationMs - 1000;
    const base: Bar = { tf, openTime, closeTime, open: 101, high: 106, low: 96, close: 101, volume: 1000 };
    return { ...base, ...(overrides[i] ?? {}) };
  });
}

function buildExecutionM15Bars(): Bar[] {
  return buildBars("M15", 20, {
    9: { low: 99 },
    10: { low: 98.5 },
    11: { low: 96.5, high: 105 },
    12: { low: 99 },
    13: { low: 98, high: 106 },
    14: { low: 97, high: 107 },
    15: { low: 96, high: 106, close: 102 },
    16: { low: 97, high: 108, close: 103 },
    17: { low: 97.2, high: 107, close: 104 },
    18: { open: 103, high: 106, low: 95, close: 105 },
    19: { open: 105, high: 110, low: 100, close: 109 },
  }, M15_START);
}

function buildRuntimeM5Bars(lastCloseTime: number): Bar[] {
  const start = lastCloseTime - 60 * 5 * 60 * 1000;
  return buildBars("M5", 60, {}, start).map((bar, index) => ({
    ...bar,
    open: 96 + index * 0.12,
    high: 97 + index * 0.12,
    low: 95.5 + index * 0.12,
    close: 96.4 + index * 0.12,
    volume: 2000 + index * 10,
  }));
}

function buildRuntimeH1Bars(lastCloseTime: number): Bar[] {
  const start = lastCloseTime - 40 * 60 * 60 * 1000;
  return Array.from({ length: 40 }, (_, index) => {
    const openTime = start + index * 60 * 60 * 1000;
    return {
      tf: "H1" as const,
      openTime,
      closeTime: openTime + 60 * 60 * 1000 - 1000,
      open: 90 + index * 0.8,
      high: 91.5 + index * 0.8,
      low: 89.5 + index * 0.8,
      close: 91 + index * 0.8,
      volume: 5000 + index * 50,
    };
  });
}

async function main(): Promise<void> {
  clearRuntimePoiStore(SYMBOL);
  clearMarketContext(SYMBOL);
  clearBookTickerCache(SYMBOL);
  setCachedTickSize(SYMBOL, TICK);
  replaceRuntimeChannelPois(SYMBOL, buildProvider());

  const engine = createFvgIndicatorEngine(SYMBOL);
  const h4Events: string[] = [];
  for (const bar of buildH4Bars()) {
    h4Events.push(...engine.onBarClose(bar));
  }

  const confirmEvent = h4Events.find((line) => line.includes("[CONFIRM][4H][FVG][A]")) ?? null;
  assert.equal(confirmEvent, "[CONFIRM][4H][FVG][A] tags=F1+F2+F4 zone=100.0~102.0");

  const activePoi = listRuntimePois(SYMBOL).find((poi) => poi.kind === "FVG" && poi.type === "H4_CORE_FVG" && poi.state === "A_ACTIVE");
  assert.ok(activePoi);

  let entryRawEvent: string | null = null;
  let entrySeed: ReturnType<typeof buildRouterRawSignalCandidatesForBar>[number] | null = null;
  let entryBar: Bar | null = null;

  for (const bar of buildExecutionM15Bars()) {
    const rawEvents = engine.onBarClose(bar);
    const seeds = buildRouterRawSignalCandidatesForBar({ symbol: SYMBOL, bar, rawEvents, tickSize: TICK });
    const nextSeed = seeds.find((seed) => seed.eventName === "ENTRY_WINDOW_OPEN" && seed.poiKind === "FVG") ?? null;
    if (nextSeed) {
      entryRawEvent = rawEvents.find((line) => line.includes("[ENTRY_WINDOW_OPEN]")) ?? null;
      entrySeed = nextSeed;
      entryBar = bar;
      break;
    }
  }

  assert.ok(entryRawEvent);
  assert.ok(entrySeed);
  assert.ok(entryBar);

  const openTimeMs = Date.parse(entrySeed.openTime);
  for (const bar of buildExecutionM15Bars()) appendMarketBar(SYMBOL, bar);
  for (const bar of buildRuntimeM5Bars(openTimeMs)) appendMarketBar(SYMBOL, bar);
  for (const bar of buildRuntimeH1Bars(openTimeMs)) appendMarketBar(SYMBOL, bar);

  upsertBookTicker({
    symbol: SYMBOL,
    bid: entrySeed.entryRefPrice - 0.05,
    ask: entrySeed.entryRefPrice + 0.05,
    eventTime: openTimeMs,
    recvTime: openTimeMs,
  });

  const runtimePolicy = buildRuntimePolicyResultFromSeed({
    seed: entrySeed,
    syncState: { syncing: false, dataOk: true, gapDetected: false, syncSource: null },
    recentConcentrationHistory15m: [],
  });
  assert.ok(runtimePolicy);

  let dbBackedPolicyDecision: string | null = null;
  let dbBackedPolicyError: string | null = null;
  try {
    const dbBacked = await buildDbBackedRuntimePolicyResultFromSeed({
      seed: entrySeed,
      syncState: { syncing: false, dataOk: true, gapDetected: false, syncSource: null },
    });
    dbBackedPolicyDecision = dbBacked?.policy.decision ?? null;
  } catch (error) {
    dbBackedPolicyError = error instanceof Error ? error.message : String(error);
  }

  const routerCandidate = buildRuntimeRouterCandidate({
    seed: entrySeed,
    signal: runtimePolicy.signal,
    policy: runtimePolicy.policy,
    emissionBar: { high: entryBar.high, low: entryBar.low },
  });
  assert.ok(routerCandidate);

  const best = selectBest1OpenCandidate([routerCandidate]);
  const payload = buildRouterSendOpenPayload(routerCandidate);
  const payloadValid = hasRequiredRouterSendOpenPayloadFields(payload);
  const openEval = payloadValid
    ? evaluateTradeOpen({
        payload,
        signalBarClose: runtimePolicy.signal.lastPrice,
        tickSize: runtimePolicy.signal.tickSize,
        atrM5_14_atOpen: runtimePolicy.signal.ltAtr14,
        atrLiq_14_atOpen: runtimePolicy.atrLiq14AtOpen,
        confirmedTpPivots: runtimePolicy.confirmedTpPivots,
      })
    : null;

  console.log(JSON.stringify({
    ok: true,
    trace: {
      h4ConfirmEvent: confirmEvent,
      activePoiId: activePoi.id,
      entryRawEvent,
      entrySeed: {
        candidateId: entrySeed.candidateId,
        tradeKey: entrySeed.tradeKey,
        openTime: entrySeed.openTime,
        poiId: entrySeed.poiId,
        poiTf: entrySeed.poiTf,
        dir: entrySeed.dir,
        triggers: entrySeed.triggers,
        entryBoundaryPrice: entrySeed.entryBoundaryPrice,
        hardInvalidationPrice: entrySeed.hardInvalidationPrice,
      },
      policy: {
        decision: runtimePolicy.policy.decision,
        reasons: runtimePolicy.policy.reasons,
        riskMode: runtimePolicy.policy.riskMode,
        suggestedRiskPct: runtimePolicy.policy.suggestedRiskPct,
        evidenceLevel: runtimePolicy.policy.derived.evidenceLevel,
        usedSignature: runtimePolicy.policy.derived.usedSignature,
        sc: runtimePolicy.policy.derived.SC,
        expectedRR: runtimePolicy.signal.expectedRR ?? null,
        tpRefPrice: runtimePolicy.signal.tpRefPrice ?? null,
      },
      dbBackedPolicy: { decision: dbBackedPolicyDecision, error: dbBackedPolicyError },
      routerCandidate: routerCandidate ? { score: routerCandidate.score ?? null, poiConfTime: routerCandidate.poiConfTime, priceExtreme: routerCandidate.priceExtreme } : null,
      best1Selected: Boolean(best),
      payloadValid,
      openEval: openEval ? {
        decision: openEval.decision,
        reason: openEval.reason,
        planId: openEval.plan?.planId ?? null,
        entryQuality: openEval.plan?.entryQuality ?? null,
        rrChosen: openEval.plan?.rrChosen ?? null,
        tpPrice: openEval.plan?.tpPrice ?? null,
        stopPrice: openEval.plan?.stopPrice ?? null,
        riskPctAtOpen: openEval.plan?.riskPctAtOpen ?? null,
      } : null,
    },
  }, null, 2));
}

void main();
