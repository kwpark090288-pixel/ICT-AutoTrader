import {
  SC_BLOCK,
  SC_MARGINAL_PENALTY,
  SC_OK_PENALTY,
  SC_PENALTY_1,
  SC_PENALTY_2,
} from "../constants";
import type { CostGateEvalResult } from "../types";

export function evaluateCostGate(
  sc: number
): CostGateEvalResult | null {
  if (!Number.isFinite(sc)) {
    return null;
  }

  if (sc < SC_BLOCK) {
    return {
      decision: "BLOCK",
      sc,
      scoreDelta: 0,
      tags: [],
      reasons: ["SC_LT_3"],
    };
  }

  if (sc < SC_PENALTY_1) {
    return {
      decision: "ALLOW",
      sc,
      scoreDelta: SC_MARGINAL_PENALTY,
      tags: ["SC_MARGINAL"],
      reasons: [],
    };
  }

  if (sc < SC_PENALTY_2) {
    return {
      decision: "ALLOW",
      sc,
      scoreDelta: SC_OK_PENALTY,
      tags: ["SC_OK"],
      reasons: [],
    };
  }

  return {
    decision: "ALLOW",
    sc,
    scoreDelta: 0,
    tags: ["SC_GOOD"],
    reasons: [],
  };
}
