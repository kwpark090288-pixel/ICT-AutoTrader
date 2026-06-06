import { POLICY_DATA_STATES } from "../constants";
import type {
  DataIntegrityGateEvalResult,
  MarketSnapshot,
  PolicyDataState,
} from "../types";

export function isPolicyDataState(
  value: string
): value is PolicyDataState {
  return (POLICY_DATA_STATES as readonly string[]).includes(value);
}

export function isConsistentPolicyDataState(
  dataOk: boolean,
  dataState?: PolicyDataState | null
): boolean {
  if (!dataState) {
    return true;
  }

  if (dataOk) {
    return dataState === "OK";
  }

  return dataState === "BACKFILLING" || dataState === "GAP_DETECTED";
}

export function evaluateDataIntegrityGate(
  market: MarketSnapshot
): DataIntegrityGateEvalResult | null {
  if (typeof market.dataOk !== "boolean") {
    return null;
  }

  if (!isConsistentPolicyDataState(market.dataOk, market.dataState ?? null)) {
    return {
      decision: "BLOCK",
      scoreDelta: 0,
      tags: ["DATA_GAP"],
      reasons: ["DATA_INTEGRITY"],
      skipRemainingGates: true,
    };
  }

  if (market.dataOk === false) {
    return {
      decision: "BLOCK",
      scoreDelta: 0,
      tags: ["DATA_GAP"],
      reasons: ["DATA_INTEGRITY"],
      skipRemainingGates: true,
    };
  }

  return {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    skipRemainingGates: false,
  };
}
