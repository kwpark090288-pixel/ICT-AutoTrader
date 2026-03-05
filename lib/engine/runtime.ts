import {
  createCompositeEngine,
  type CompositeEngine,
} from "./composite-engine";

const engineStore = new Map<string, CompositeEngine>();

export function getOrInitEngine(symbol: string): CompositeEngine {
  const key = symbol.toUpperCase();
  const existing = engineStore.get(key);
  if (existing) return existing;

  const engine = createCompositeEngine();
  engineStore.set(key, engine);
  return engine;
}

export function resetEngine(symbol: string) {
  engineStore.delete(symbol.toUpperCase());
}

export function resetAllEngines() {
  engineStore.clear();
}