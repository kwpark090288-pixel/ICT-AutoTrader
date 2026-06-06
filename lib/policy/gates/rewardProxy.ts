import { uniqueLexicographicTags } from "../../engine/tags";
import {
  REWARDPROXY_HIGH_PENALTY,
  REWARDPROXY_LOW_PENALTY,
  REWARDPROXY_MID_PENALTY,
  RR_PENALTY_LT_1_0,
  RR_PENALTY_LT_1_2,
} from "../constants";
import type {
  PolicyRewardProxy,
  RewardProxyAdjustEvalResult,
} from "../types";

type EvaluateRewardProxyAdjustArgs = {
  expectedRRUsed: number | null;
  rewardProxy: PolicyRewardProxy;
};

export function evaluateRewardProxyAdjust(
  args: EvaluateRewardProxyAdjustArgs
): RewardProxyAdjustEvalResult | null {
  const { expectedRRUsed, rewardProxy } = args;

  if (
    rewardProxy !== "LOW" &&
    rewardProxy !== "MID" &&
    rewardProxy !== "HIGH"
  ) {
    return null;
  }

  if (Number.isFinite(expectedRRUsed)) {
    if ((expectedRRUsed as number) < 1.0) {
      return {
        scoreDelta: RR_PENALTY_LT_1_0,
        tags: ["RR_LT_1_0"],
        reasons: [],
        expectedRRUsed: expectedRRUsed as number,
        rewardProxy,
      };
    }

    if ((expectedRRUsed as number) < 1.2) {
      return {
        scoreDelta: RR_PENALTY_LT_1_2,
        tags: ["RR_LT_1_2"],
        reasons: [],
        expectedRRUsed: expectedRRUsed as number,
        rewardProxy,
      };
    }

    return {
      scoreDelta: 0,
      tags: ["RR_OK"],
      reasons: [],
      expectedRRUsed: expectedRRUsed as number,
      rewardProxy,
    };
  }

  if (rewardProxy === "LOW") {
    return {
      scoreDelta: REWARDPROXY_LOW_PENALTY,
      tags: uniqueLexicographicTags(["RR_UNKNOWN", "REWARDPROXY_LOW"]),
      reasons: [],
      expectedRRUsed: null,
      rewardProxy,
    };
  }

  if (rewardProxy === "MID") {
    return {
      scoreDelta: REWARDPROXY_MID_PENALTY,
      tags: uniqueLexicographicTags(["RR_UNKNOWN", "REWARDPROXY_MID"]),
      reasons: [],
      expectedRRUsed: null,
      rewardProxy,
    };
  }

  return {
    scoreDelta: REWARDPROXY_HIGH_PENALTY,
    tags: uniqueLexicographicTags(["RR_UNKNOWN", "REWARDPROXY_HIGH"]),
    reasons: [],
    expectedRRUsed: null,
    rewardProxy,
  };
}
