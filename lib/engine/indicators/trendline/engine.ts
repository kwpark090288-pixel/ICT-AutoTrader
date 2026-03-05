import type { IndicatorEngine } from "../../contracts";
import type { Bar } from "../../types";

export type TrendlineIndicatorEngine = IndicatorEngine;

export function createTrendlineIndicatorEngine(): TrendlineIndicatorEngine {
  return {
    onBarClose(_bar: Bar): string[] {
      return [];
    },
  };
}
