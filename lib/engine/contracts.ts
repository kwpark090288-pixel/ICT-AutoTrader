import type { Bar } from "./types";

/**
 * Engine responsibility lock
 * - engine generates deterministic event strings only
 * - no telegram / db / fetch / websocket / console side effects
 */
export type EngineEvent = string;

export type EngineEventBatch = EngineEvent[];

export type IndicatorEngine = {
  onBarClose(bar: Bar): EngineEventBatch;
  onBarClosePhaseA?(bar: Bar): EngineEventBatch;
  onBarClosePhaseC?(bar: Bar): EngineEventBatch;
  publishRuntimeSnapshot?(): void;
};
