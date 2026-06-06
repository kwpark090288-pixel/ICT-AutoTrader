import {
  CONSEC_LOSS_L1,
  CONSEC_LOSS_L2,
  HALT_ENTER_PNL_24H,
  HALT_EXIT_PNL_24H,
  MIN_RECOVERY_R_L1,
  MIN_RECOVERY_R_L2_SUM2WINS,
  RISK_L1_PENALTY,
  RISK_L2_PENALTY,
  RISK_PCT_HALT,
  RISK_PCT_L1,
  RISK_PCT_L2,
  RISK_PCT_NORMAL,
} from "../constants";
import type {
  AccountSnapshot,
  PolicyEvidenceLevel,
  PolicyRiskMode,
  RiskManagerEvalResult,
} from "../types";

type EvaluateRiskManagerArgs = {
  account: AccountSnapshot;
  evidenceLevel: PolicyEvidenceLevel;
  lastWinRAfterCost?: number | null;
  last2WinsRAfterCostSum?: number | null;
};

export function shouldEnterRiskHalt(
  prevRiskMode: PolicyRiskMode,
  realizedPnl24hPct: number
): boolean {
  return prevRiskMode !== "HALT" && realizedPnl24hPct <= HALT_ENTER_PNL_24H;
}

export function shouldStayRiskHalt(
  prevRiskMode: PolicyRiskMode,
  realizedPnl24hPct: number
): boolean {
  return prevRiskMode === "HALT" && realizedPnl24hPct <= HALT_EXIT_PNL_24H;
}

export function getBaseRiskModeFromConsecutiveLosses(
  consecutiveLosses: number
): Exclude<PolicyRiskMode, "HALT"> {
  if (consecutiveLosses >= CONSEC_LOSS_L2) {
    return "L2";
  }

  if (consecutiveLosses >= CONSEC_LOSS_L1) {
    return "L1";
  }

  return "NORMAL";
}

export function reevaluateRiskMode(args: {
  prevRiskMode: PolicyRiskMode;
  consecutiveLosses: number;
  lastWinRAfterCost?: number | null;
  last2WinsRAfterCostSum?: number | null;
}): Exclude<PolicyRiskMode, "HALT"> {
  const {
    prevRiskMode,
    consecutiveLosses,
    lastWinRAfterCost,
    last2WinsRAfterCostSum,
  } = args;

  const base = getBaseRiskModeFromConsecutiveLosses(consecutiveLosses);

  if (prevRiskMode === "L2") {
    if (
      Number.isFinite(last2WinsRAfterCostSum) &&
      (last2WinsRAfterCostSum as number) >= MIN_RECOVERY_R_L2_SUM2WINS
    ) {
      return "L1";
    }

    return "L2";
  }

  if (prevRiskMode === "L1") {
    if (base === "L2") {
      return "L2";
    }

    if (
      Number.isFinite(lastWinRAfterCost) &&
      (lastWinRAfterCost as number) >= MIN_RECOVERY_R_L1
    ) {
      return "NORMAL";
    }

    return "L1";
  }

  return base;
}

export function getSuggestedRiskPctByMode(
  riskMode: PolicyRiskMode
): number {
  if (riskMode === "HALT") {
    return RISK_PCT_HALT;
  }

  if (riskMode === "L2") {
    return RISK_PCT_L2;
  }

  if (riskMode === "L1") {
    return RISK_PCT_L1;
  }

  return RISK_PCT_NORMAL;
}

export function applyColdstartRiskClamp(
  suggestedRiskPct: number,
  evidenceLevel: PolicyEvidenceLevel
): number {
  if (evidenceLevel === "NO_EVIDENCE") {
    return Math.min(suggestedRiskPct, RISK_PCT_L1);
  }

  return suggestedRiskPct;
}

export function evaluateRiskManager(
  args: EvaluateRiskManagerArgs
): RiskManagerEvalResult | null {
  const {
    account,
    evidenceLevel,
    lastWinRAfterCost,
    last2WinsRAfterCostSum,
  } = args;

  if (
    !Number.isFinite(account.realizedPnl_24h_pct) ||
    !Number.isFinite(account.consecutiveLosses)
  ) {
    return null;
  }

  if (shouldEnterRiskHalt(account.riskMode, account.realizedPnl_24h_pct)) {
    return {
      decision: "BLOCK",
      riskMode: "HALT",
      scoreDelta: 0,
      tags: [],
      reasons: ["RISK_HALT_ROLLING_24H"],
      suggestedRiskPct: 0,
    };
  }

  if (shouldStayRiskHalt(account.riskMode, account.realizedPnl_24h_pct)) {
    return {
      decision: "BLOCK",
      riskMode: "HALT",
      scoreDelta: 0,
      tags: [],
      reasons: ["RISK_HALT_ROLLING_24H"],
      suggestedRiskPct: 0,
    };
  }

  const riskMode = reevaluateRiskMode({
    prevRiskMode: account.riskMode,
    consecutiveLosses: account.consecutiveLosses,
    lastWinRAfterCost,
    last2WinsRAfterCostSum,
  });

  const suggestedRiskPct = applyColdstartRiskClamp(
    getSuggestedRiskPctByMode(riskMode),
    evidenceLevel
  );

  if (riskMode === "L2") {
    return {
      decision: "ALLOW",
      riskMode,
      scoreDelta: RISK_L2_PENALTY,
      tags: ["RISK_L2"],
      reasons: [],
      suggestedRiskPct,
    };
  }

  if (riskMode === "L1") {
    return {
      decision: "ALLOW",
      riskMode,
      scoreDelta: RISK_L1_PENALTY,
      tags: ["RISK_L1"],
      reasons: [],
      suggestedRiskPct,
    };
  }

  return {
    decision: "ALLOW",
    riskMode,
    scoreDelta: 0,
    tags: [],
    reasons: [],
    suggestedRiskPct,
  };
}
