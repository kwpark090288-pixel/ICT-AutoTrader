import type { IndicatorEngine } from "../../contracts";
import type { Bar } from "../../types";

export type ObIndicatorEngine = IndicatorEngine;

export function createObIndicatorEngine(): ObIndicatorEngine {
  return {
    onBarClose(_bar: Bar): string[] {
      return [];
    },
  };
}
