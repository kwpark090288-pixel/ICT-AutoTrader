import type { Bar } from "./types";
import { toIsoUtc } from "./time";

export type EngineRuntime = {
  symbol: string;
  onBarClose(bar: Bar): string[];
};

const ENGINE_STORE: Map<string, EngineRuntime> = (() => {
  if (typeof window === "undefined") return new Map<string, EngineRuntime>();
  const w = window as any;
  return w.__ENGINE_STORE ?? (w.__ENGINE_STORE = new Map<string, EngineRuntime>());
})();

function createEngine(symbol: string): EngineRuntime {
  return {
    symbol,
    onBarClose(bar: Bar) {
      // ✅ 지금은 “배선 검증”이 목적이라 디버그 이벤트만 찍는다.
      // (정본 이벤트 포맷은 FVG/OB/CH/TL 구현 들어가면서 거기서만 출력)
      return [
        `[DBG][BAR_CLOSE][${bar.tf}] time=${toIsoUtc(bar.closeTime)} o=${bar.open} h=${bar.high} l=${bar.low} c=${bar.close}`,
      ];
    },
  };
}

export function getOrInitEngine(symbol: string): EngineRuntime {
  const prev = ENGINE_STORE.get(symbol);
  if (prev) return prev;
  const next = createEngine(symbol);
  ENGINE_STORE.set(symbol, next);
  return next;
}

