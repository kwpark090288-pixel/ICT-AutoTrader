import {
  clearRuntimePoiStore,
  resolveRuntimeInvalidationTime,
  syncRuntimeChannelExecutionInvalidationPois,
} from "../lib/engine/runtime-poi-store";
import { formatTradePlanCloseEvent } from "../lib/tradelifecycle/closeOutput";
import { applyTradeMonitorOnBar } from "../lib/tradelifecycle/monitor";
import { finalizeClosedTradeReview } from "../lib/tradelifecycle/review";
import type { TradePlan } from "../lib/tradelifecycle/types";

function buildSmokePlan(poiId: string): TradePlan {
  return {
    planId: "SMOKE|LONG|CH1@2026-06-01T00:00:00Z",
    planKey: "SMOKE|LONG|CH1",
    symbol: "SMOKE",
    dir: "LONG",
    source: "CHANNEL",
    poiTier: "H4_CORE",
    poiId,
    invalidationRef: {
      source: "CHANNEL_POI",
      refId: poiId,
    },
    eventType: "ENTRY_WINDOW_OPEN",
    tf: "H4",
    openTime: "2026-06-01T00:00:00Z",
    entryRefPrice: 100,
    entryBoundaryPrice: 100,
    hardInvalidationPrice: 95,
    stopPrice: 94.5,
    tpPrice: 110,
    tpMode: "RR",
    rrBase: 2,
    rrChosen: 2,
    rrMaxUsed: 2,
    atrM5_14_atOpen: 1.5,
    stopBuffer: 0.5,
    entryQuality: "IDEAL",
    timeoutMinutes: 240,
    timeoutDueTime: "2026-06-01T04:00:00.000Z",
    tpLiqTf: "H1",
    atrLiq_14_atOpen: 2,
    status: "OPEN",
    mfeR: 0,
    maeR: 0,
    score: 88,
    collabStrength: "STRONG",
    riskPctAtOpen: 0.006,
    tags: ["CHANNEL"],
    policySnapshot: {
      decision: "ALLOW",
      regimeState: "NORMAL",
      c_bps: 25,
      sc: 4.2,
    },
  };
}

async function main(): Promise<void> {
  clearRuntimePoiStore("SMOKE");

  const openTime = "2026-06-01T00:00:00Z";
  const poiId = "SMOKE:CH_POI:H4:1:BULL:100";
  const plan = buildSmokePlan(poiId);

  syncRuntimeChannelExecutionInvalidationPois("SMOKE", [
    {
      id: poiId,
      symbol: "SMOKE",
      tf: "H4",
      dir: "BULL",
      createdAt: Date.parse(openTime),
      boundaryPrice: 100,
      triggers: ["structure", "sweepRec"],
      state: "INACTIVE",
      endTime: Date.parse(openTime),
      invalidReason: "expired_forward",
    },
  ]);

  const lookup = resolveRuntimeInvalidationTime({
    symbol: "SMOKE",
    invalidationRef: plan.invalidationRef,
  });
  const missingLookup = resolveRuntimeInvalidationTime({
    symbol: "SMOKE",
    invalidationRef: {
      source: "CHANNEL_POI",
      refId: "MISSING",
    },
  });

  const openBarEval = applyTradeMonitorOnBar({
    plan,
    bar: {
      tf: "M5",
      openTime: Date.parse("2026-05-31T23:55:00Z"),
      closeTime: Date.parse(openTime),
      open: 100,
      high: 100.2,
      low: 99.8,
      close: 100.1,
      volume: 1,
    },
    tickSize: 0.1,
    invalidTime: lookup.invalidTime,
  });

  const nextBarEval = applyTradeMonitorOnBar({
    plan,
    bar: {
      tf: "M5",
      openTime: Date.parse(openTime),
      closeTime: Date.parse("2026-06-01T00:05:00Z"),
      open: 100.1,
      high: 100.3,
      low: 99.6,
      close: 99.9,
      volume: 1,
    },
    tickSize: 0.1,
    invalidTime: lookup.invalidTime,
  });

  const reviewed = finalizeClosedTradeReview(nextBarEval);

  console.log(
    JSON.stringify(
      {
        lookup,
        missingLookup,
        openBarEval: {
          status: openBarEval.status,
          outcome: openBarEval.outcome ?? null,
          closeTime: openBarEval.closeTime ?? null,
        },
        nextBarEval: {
          status: nextBarEval.status,
          outcome: nextBarEval.outcome ?? null,
          closeTime: nextBarEval.closeTime ?? null,
          exitPrice: nextBarEval.exitPrice ?? null,
        },
        closeLine: formatTradePlanCloseEvent(reviewed),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[LIFECYCLE_SOFT_INVALID_SMOKE_ERROR]", error);
  process.exit(1);
});
