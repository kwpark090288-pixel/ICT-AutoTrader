import { uniqueLexicographicTags } from "../../engine/tags";
import {
  PORTFOLIO_CAP_HALT,
  PORTFOLIO_CAP_L1,
  PORTFOLIO_CAP_L2,
  PORTFOLIO_CAP_NORMAL,
} from "../constants";
import type {
  AccountSnapshot,
  PolicyRiskMode,
  PortfolioExposureGateEvalResult,
} from "../types";

type EvaluatePortfolioExposureGateArgs = {
  account: AccountSnapshot;
  riskMode: PolicyRiskMode;
  suggestedRiskPct: number;
};

export function getPortfolioCapByRiskMode(
  riskMode: PolicyRiskMode
): number {
  if (riskMode === "HALT") {
    return PORTFOLIO_CAP_HALT;
  }

  if (riskMode === "L2") {
    return PORTFOLIO_CAP_L2;
  }

  if (riskMode === "L1") {
    return PORTFOLIO_CAP_L1;
  }

  return PORTFOLIO_CAP_NORMAL;
}

export function evaluatePortfolioExposureGate(
  args: EvaluatePortfolioExposureGateArgs
): PortfolioExposureGateEvalResult | null {
  const { account, riskMode, suggestedRiskPct } = args;

  if (!Number.isFinite(suggestedRiskPct) || suggestedRiskPct < 0) {
    return null;
  }

  const cap = getPortfolioCapByRiskMode(riskMode);

  if (!Number.isFinite(account.openRiskPct as number)) {
    return {
      decision: "ALLOW",
      scoreDelta: 0,
      tags: uniqueLexicographicTags(["PORTFOLIO_UNKNOWN"]),
      reasons: [],
      suggestedRiskPct,
      cap,
      skipped: true,
    };
  }

  const openRiskPct = account.openRiskPct as number;

  if (openRiskPct >= cap) {
    return {
      decision: "BLOCK",
      scoreDelta: 0,
      tags: [],
      reasons: uniqueLexicographicTags(["PORTFOLIO_FULL"]),
      suggestedRiskPct: 0,
      cap,
      skipped: false,
    };
  }

  if (openRiskPct + suggestedRiskPct > cap) {
    return {
      decision: "ALLOW",
      scoreDelta: 0,
      tags: uniqueLexicographicTags(["PORTFOLIO_TRIMMED"]),
      reasons: uniqueLexicographicTags(["PORTFOLIO_TRIMMED"]),
      suggestedRiskPct: cap - openRiskPct,
      cap,
      skipped: false,
    };
  }

  return {
    decision: "ALLOW",
    scoreDelta: 0,
    tags: [],
    reasons: [],
    suggestedRiskPct,
    cap,
    skipped: false,
  };
}