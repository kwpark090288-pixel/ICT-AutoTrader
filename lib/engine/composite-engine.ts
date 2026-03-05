import type { EngineEventBatch, IndicatorEngine } from "./contracts";
import type { Bar } from "./types";
import { createChannelIndicatorEngine } from "./indicators/channel/engine";
import { createFvgIndicatorEngine } from "./indicators/fvg/engine";
import { createObIndicatorEngine } from "./indicators/ob/engine";
import { createTrendlineIndicatorEngine } from "./indicators/trendline/engine";

export type CompositeEngine = IndicatorEngine;

export function createCompositeEngine(): CompositeEngine {
  const fvg: IndicatorEngine = createFvgIndicatorEngine();
  const ob: IndicatorEngine = createObIndicatorEngine();
  const channel: IndicatorEngine = createChannelIndicatorEngine();
  const trendline: IndicatorEngine = createTrendlineIndicatorEngine();

  return {
    onBarClose(bar: Bar): EngineEventBatch {
      return [
        ...fvg.onBarClose(bar),
        ...ob.onBarClose(bar),
        ...channel.onBarClose(bar),
        ...trendline.onBarClose(bar),
      ];
    },
  };
}
