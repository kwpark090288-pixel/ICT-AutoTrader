import type { IndicatorEngine } from "../../contracts";
import type { Bar } from "../../types";

export type ChannelIndicatorEngine = IndicatorEngine;

export function createChannelIndicatorEngine(): ChannelIndicatorEngine {
  return {
    onBarClose(_bar: Bar): string[] {
      return [];
    },
  };
}
