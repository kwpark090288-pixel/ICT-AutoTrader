import type {
  ConcentrationHistoryItem,
  PolicyDir,
} from "../policy/types";
import type { StoredSignalPoiHighlight } from "../alerts/types";
import type { RouterTradeDir } from "../router/types";
import type { RouterTradeKeyStatusRef } from "../router/candidate";
import type {
  TradeActivePlanRef,
  TradePlan,
} from "./types";

type RuntimeOpenedTradeRecord = {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight?: StoredSignalPoiHighlight;
};

export interface RuntimeOpenedTradeSnapshot {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight?: StoredSignalPoiHighlight;
}

const runtimeOpenedTradesByPlanId = new Map<string, RuntimeOpenedTradeRecord>();
const runtimeConcentrationHistory: ConcentrationHistoryItem[] = [];

function toPolicyDir(dir: RouterTradeDir): PolicyDir {
  return dir === "LONG" ? "BULL" : "BEAR";
}

export function clearRuntimeTradeStore(symbol?: string): void {
  if (!symbol) {
    runtimeOpenedTradesByPlanId.clear();
    runtimeConcentrationHistory.length = 0;
    return;
  }

  const normalized = symbol.toUpperCase();

  for (const [planId, record] of runtimeOpenedTradesByPlanId.entries()) {
    if (record.plan.symbol.toUpperCase() === normalized) {
      runtimeOpenedTradesByPlanId.delete(planId);
    }
  }

  for (let i = runtimeConcentrationHistory.length - 1; i >= 0; i -= 1) {
    if (runtimeConcentrationHistory[i].symbol.toUpperCase() === normalized) {
      runtimeConcentrationHistory.splice(i, 1);
    }
  }
}

export function registerRuntimeOpenedTrade(args: {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight?: StoredSignalPoiHighlight;
}): void {
  hydrateRuntimeOpenedTrade({
    ...args,
    includeConcentrationHistory: true,
  });
}

export function hydrateRuntimeOpenedTrade(args: {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight?: StoredSignalPoiHighlight;
  includeConcentrationHistory?: boolean;
}): void {
  runtimeOpenedTradesByPlanId.set(args.plan.planId, {
    tradeKey: args.tradeKey,
    zoneKey: args.zoneKey,
    plan: args.plan,
    poiClusterKey: args.poiClusterKey,
    poiHighlight: args.poiHighlight,
  });

  if (args.includeConcentrationHistory !== false) {
    runtimeConcentrationHistory.push({
      time: args.plan.openTime,
      symbol: args.plan.symbol,
      dir: toPolicyDir(args.plan.dir),
      poiClusterKey: args.poiClusterKey,
    });
  }
}

export function listRuntimeActiveTradeKeyRefs(): RouterTradeKeyStatusRef[] {
  return [...runtimeOpenedTradesByPlanId.values()].map((record) => ({
    tradeKey: record.tradeKey,
    status: record.plan.status,
  }));
}

export function listRuntimeActiveTradePlanRefs(): TradeActivePlanRef[] {
  return [...runtimeOpenedTradesByPlanId.values()].map((record) => ({
    symbol: record.plan.symbol,
    dir: record.plan.dir,
    status: record.plan.status,
    zoneKey: record.zoneKey,
  }));
}

export function listRuntimeConcentrationHistory(): ConcentrationHistoryItem[] {
  return [...runtimeConcentrationHistory];
}

export function listRuntimeOpenedTradePlans(): TradePlan[] {
  return [...runtimeOpenedTradesByPlanId.values()].map((record) => record.plan);
}

export function listRuntimeOpenedTradeRecords(
  symbol?: string
): RuntimeOpenedTradeSnapshot[] {
  const records = [...runtimeOpenedTradesByPlanId.values()];

  if (!symbol) {
    return records.map((record) => ({ ...record }));
  }

  const normalized = symbol.toUpperCase();
  return records
    .filter((record) => record.plan.symbol.toUpperCase() === normalized)
    .map((record) => ({ ...record }));
}

export function updateRuntimeTradePlan(
  plan: TradePlan
): void {
  const existing = runtimeOpenedTradesByPlanId.get(plan.planId);
  if (!existing) {
    return;
  }

  runtimeOpenedTradesByPlanId.set(plan.planId, {
    ...existing,
    plan,
  });
}
