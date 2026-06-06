import type { EngineEventBatch, IndicatorEngine } from "./contracts";
import type { Bar } from "./types";
import { createChannelIndicatorEngine } from "./indicators/channel/engine";
import { createFvgIndicatorEngine } from "./indicators/fvg/engine";
import { createObIndicatorEngine } from "./indicators/ob/engine";
import { createTrendlineIndicatorEngine } from "./indicators/trendline/engine";

export type CompositeEngine = IndicatorEngine;

export function runCompositeEngineBatch(
  engines: readonly IndicatorEngine[],
  bar: Bar
): EngineEventBatch {
  const phaseAEvents: string[] = [];
  const phaseCEevents: string[] = [];
  const supportsPhasedBatch = engines.every(
    (engine) =>
      typeof engine.onBarClosePhaseA === "function" &&
      typeof engine.onBarClosePhaseC === "function" &&
      typeof engine.publishRuntimeSnapshot === "function"
  );

  if (!supportsPhasedBatch) {
    return engines.flatMap((engine) => engine.onBarClose(bar));
  }

  for (const engine of engines) {
    phaseAEvents.push(...(engine.onBarClosePhaseA?.(bar) ?? []));
  }

  for (const engine of engines) {
    engine.publishRuntimeSnapshot?.();
  }

  for (const engine of engines) {
    phaseCEevents.push(...(engine.onBarClosePhaseC?.(bar) ?? []));
  }

  for (const engine of engines) {
    engine.publishRuntimeSnapshot?.();
  }

  return [...phaseAEvents, ...phaseCEevents];
}

export function createCompositeEngine(symbol: string = "UNKNOWN"): CompositeEngine {
  const fvg: IndicatorEngine = createFvgIndicatorEngine(symbol);
  const channel: IndicatorEngine = createChannelIndicatorEngine(symbol);
  const trendline: IndicatorEngine = createTrendlineIndicatorEngine(symbol);
  const ob: IndicatorEngine = createObIndicatorEngine(symbol);

  return {
    onBarClose(bar: Bar): EngineEventBatch {
      return runCompositeEngineBatch([fvg, channel, trendline, ob], bar);
    },
  };
}
