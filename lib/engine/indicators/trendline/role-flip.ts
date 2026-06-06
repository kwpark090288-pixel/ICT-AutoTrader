import {
  ROLE_FLIP_CONFIRM_WINDOW_BARS,
  ROLE_FLIP_TAG,
} from "./constants";
import { getTrendlineLinePriceAt } from "./lifecycle";
import type {
  Trendline,
  TrendlineBar,
  TrendlineBreakEvalResult,
  TrendlineTouchEvalResult,
  TrendlineType,
} from "./types";

type ApplyTrendlineRoleFlipArgs = {
  line: Trendline;
  bar: TrendlineBar;
  breakEval?: TrendlineBreakEvalResult | null;
  touchEval?: TrendlineTouchEvalResult | null;
};

export function getTrendlineRoleFlipOppositeType(
  type: TrendlineType
): TrendlineType {
  return type === "TL_SUPPORT" ? "TL_RESIST" : "TL_SUPPORT";
}

export function shouldStartTrendlineRoleFlipWatch(
  line: Trendline,
  breakEval?: TrendlineBreakEvalResult | null
): boolean {
  if (line.state !== "ACTIVE") {
    return false;
  }

  if (line.roleFlipWatch) {
    return false;
  }

  return Boolean(breakEval?.breakCandidate);
}

export function evaluateTrendlineRoleFlipOppositeClose(
  line: Trendline,
  bar: TrendlineBar,
  typeBefore: TrendlineType = line.roleFlipWatch?.typeBefore ?? line.type
): boolean {
  const linePrice = getTrendlineLinePriceAt(line, bar.closeTime);

  return typeBefore === "TL_SUPPORT"
    ? bar.close < linePrice
    : bar.close > linePrice;
}

export function applyTrendlineRoleFlip(
  args: ApplyTrendlineRoleFlipArgs
): Trendline {
  const { line, bar, breakEval, touchEval } = args;

  if (line.state !== "ACTIVE") {
    return line;
  }

  if (bar.tf !== line.tf) {
    return line;
  }

  let next: Trendline = {
    ...line,
    tags: [...line.tags],
    roleFlipWatch: line.roleFlipWatch
      ? { ...line.roleFlipWatch }
      : undefined,
  };

  if (shouldStartTrendlineRoleFlipWatch(next, breakEval)) {
    next.roleFlipWatch = {
      startedAt: bar.closeTime,
      typeBefore: next.type,
      touchSeen: false,
      barsSinceTouch: 0,
    };
  }

  if (!next.roleFlipWatch) {
    return next;
  }

  if (touchEval?.touched && touchEval.currentCloseTime === bar.closeTime) {
    next.roleFlipWatch = {
      ...next.roleFlipWatch,
      touchSeen: true,
      touchTime: bar.closeTime,
      barsSinceTouch: 0,
    };
  } else if (next.roleFlipWatch.touchSeen) {
    next.roleFlipWatch = {
      ...next.roleFlipWatch,
      barsSinceTouch: next.roleFlipWatch.barsSinceTouch + 1,
    };
  }

  const typeBefore = next.roleFlipWatch.typeBefore;

  const confirm =
    next.roleFlipWatch.touchSeen &&
    next.roleFlipWatch.barsSinceTouch <= ROLE_FLIP_CONFIRM_WINDOW_BARS &&
    evaluateTrendlineRoleFlipOppositeClose(next, bar, typeBefore);

  if (confirm) {
    return {
      ...next,
      type: getTrendlineRoleFlipOppositeType(typeBefore),
      roleFlipCount: next.roleFlipCount + 1,
      tags: next.tags.includes(ROLE_FLIP_TAG)
        ? next.tags
        : [...next.tags, ROLE_FLIP_TAG],
      roleFlipWatch: undefined,
    };
  }

  if (
    next.roleFlipWatch.touchSeen &&
    next.roleFlipWatch.barsSinceTouch > ROLE_FLIP_CONFIRM_WINDOW_BARS
  ) {
    return {
      ...next,
      roleFlipWatch: undefined,
    };
  }

  return next;
}
