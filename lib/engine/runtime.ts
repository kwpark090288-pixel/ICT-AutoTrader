import {
  createCompositeEngine,
  type CompositeEngine,
} from "./composite-engine";
import { clearBookTickerCache } from "./book-ticker";
import { clearMarketContext } from "./market-context";
import { clearRuntimePoiStore } from "./runtime-poi-store";
import { clearRuntimeTradeStore } from "../tradelifecycle/runtime-store";

const engineStore = new Map<string, CompositeEngine>();

export function getOrInitEngine(symbol: string): CompositeEngine {
  const key = symbol.toUpperCase();
  const existing = engineStore.get(key);
  if (existing) return existing;

  const engine = createCompositeEngine(key);
  engineStore.set(key, engine);
  return engine;
}

export function resetEngine(symbol: string) {
  const key = symbol.toUpperCase();
  engineStore.delete(key);
  clearMarketContext(key);
  clearRuntimePoiStore(key);
  clearBookTickerCache(key);
  clearRuntimeTradeStore(key);
}

export function resetAllEngines() {
  engineStore.clear();
  clearMarketContext();
  clearRuntimePoiStore();
  clearBookTickerCache();
  clearRuntimeTradeStore();
}
