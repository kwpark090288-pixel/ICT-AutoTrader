import {
  BREAK_CLOSES_D1,
  BREAK_CLOSES_H1,
  BREAK_CLOSES_H4,
  BREAK_CLOSES_M30,
  BREAK_MARGIN_ATR_D1,
  BREAK_MARGIN_ATR_H1,
  BREAK_MARGIN_ATR_H4,
  BREAK_MARGIN_ATR_M30,
  ROLE_FLIP_TOUCH_MARGIN_ATR,
  TRENDLINE_MODEL_TFS,
} from "./constants";
import type {
  StructureState,
  Trendline,
  TrendlineBar,
  TrendlineBreakEvalResult,
  TrendlineModelTf,
  TrendlineStaleEvalResult,
  TrendlineTouchEvalResult,
} from "./types";

type TrendlineBreakRule = {
  requiredCloses: number;
  atrMultiplier: number;
};

type EvaluateTrendlineTouchAtBarArgs = {
  line: Trendline;
  bar: TrendlineBar;
  atrAtBar: number;
};

type EvaluateTrendlineBreakAtBarArgs = {
  line: Trendline;
  tfBars: readonly TrendlineBar[];
  currentIndex: number;
  atrAtBar: number;
  structureState: StructureState;
};

type ApplyTrendlineLifecycleInvalidationArgs = {
  line: Trendline;
  currentCloseTime: number;
  breakEval?: TrendlineBreakEvalResult | null;
  staleEval?: TrendlineStaleEvalResult | null;
};

function assertSameTfAscending(bars: readonly TrendlineBar[]) {
  if (bars.length === 0) return;

  const tf = bars[0].tf;

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].tf !== tf) {
      throw new Error("Trendline lifecycle bars must have the same TF");
    }

    if (bars[i - 1].closeTime >= bars[i].closeTime) {
      throw new Error("Trendline lifecycle bars must be strictly ascending by closeTime");
    }
  }
}

export function isTrendlineLifecycleTf(
  tf: string
): tf is TrendlineModelTf {
  return (TRENDLINE_MODEL_TFS as readonly string[]).includes(tf);
}

export function getTrendlineBreakRule(
  tf: TrendlineModelTf,
  structureState: StructureState
): TrendlineBreakRule {
  const mixedRequiredCloses = structureState === "MIXED" ? 1 : null;

  if (tf === "D1") {
    return {
      requiredCloses: mixedRequiredCloses ?? BREAK_CLOSES_D1,
      atrMultiplier: BREAK_MARGIN_ATR_D1,
    };
  }

  if (tf === "H4") {
    return {
      requiredCloses: mixedRequiredCloses ?? BREAK_CLOSES_H4,
      atrMultiplier: BREAK_MARGIN_ATR_H4,
    };
  }

  if (tf === "H1") {
    return {
      requiredCloses: mixedRequiredCloses ?? BREAK_CLOSES_H1,
      atrMultiplier: BREAK_MARGIN_ATR_H1,
    };
  }

  return {
    requiredCloses: mixedRequiredCloses ?? BREAK_CLOSES_M30,
    atrMultiplier: BREAK_MARGIN_ATR_M30,
  };
}

export function getTrendlineLinePriceAt(
  line: Trendline,
  time: number
): number {
  const slope = (line.a2Price - line.a1Price) / (line.a2Time - line.a1Time);
  const intercept = line.a1Price - slope * line.a1Time;
  return slope * time + intercept;
}

export function evaluateTrendlineTouchAtBar(
  args: EvaluateTrendlineTouchAtBarArgs
): TrendlineTouchEvalResult | null {
  const { line, bar, atrAtBar } = args;

  if (!isTrendlineLifecycleTf(line.tf)) return null;
  if (bar.tf !== line.tf) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;

  const linePrice = getTrendlineLinePriceAt(line, bar.closeTime);
  const touchMargin = atrAtBar * ROLE_FLIP_TOUCH_MARGIN_ATR;

  const touched =
    line.type === "TL_SUPPORT"
      ? bar.low <= linePrice + touchMargin
      : bar.high >= linePrice - touchMargin;

  return {
    tf: line.tf,
    currentCloseTime: bar.closeTime,
    linePrice,
    touchMargin,
    touched,
  };
}

function isBreakCandidate(
  line: Trendline,
  close: number,
  linePrice: number,
  atrAtBar: number,
  atrMultiplier: number
): boolean {
  const margin = atrAtBar * atrMultiplier;

  return line.type === "TL_SUPPORT"
    ? close < linePrice - margin
    : close > linePrice + margin;
}

function getBreakDeviation(
  line: Trendline,
  close: number,
  linePrice: number
): number {
  return line.type === "TL_SUPPORT"
    ? Math.max(0, linePrice - close)
    : Math.max(0, close - linePrice);
}

export function evaluateTrendlineBreakAtBar(
  args: EvaluateTrendlineBreakAtBarArgs
): TrendlineBreakEvalResult | null {
  const { line, tfBars, currentIndex, atrAtBar, structureState } = args;

  if (!isTrendlineLifecycleTf(line.tf)) return null;
  if (!Number.isInteger(currentIndex)) return null;
  if (currentIndex < 0 || currentIndex >= tfBars.length) return null;
  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) return null;

  assertSameTfAscending(tfBars);

  const currentBar = tfBars[currentIndex];
  if (currentBar.tf !== line.tf) {
    return null;
  }

  const rule = getTrendlineBreakRule(line.tf, structureState);

  const currentLinePrice = getTrendlineLinePriceAt(line, currentBar.closeTime);

  let breakCount = 0;

  for (let i = currentIndex; i >= 0; i -= 1) {
    const bar = tfBars[i];
    const price = getTrendlineLinePriceAt(line, bar.closeTime);

    if (!isBreakCandidate(line, bar.close, price, atrAtBar, rule.atrMultiplier)) {
      break;
    }

    breakCount += 1;
  }

  const breakCandidate = isBreakCandidate(
    line,
    currentBar.close,
    currentLinePrice,
    atrAtBar,
    rule.atrMultiplier
  );

  const closeDeviation = getBreakDeviation(
    line,
    currentBar.close,
    currentLinePrice
  );

  return {
    tf: line.tf,
    currentCloseTime: currentBar.closeTime,
    requiredCloses: rule.requiredCloses,
    atrAtBar,
    atrMultiplier: rule.atrMultiplier,
    breakCount,
    linePrice: currentLinePrice,
    closeDeviation,
    breakCandidate,
    breakConfirmed: breakCount >= rule.requiredCloses,
  };
}

export function evaluateTrendlineStaleExpiration(
  line: Trendline,
  currentCloseTime: number
): TrendlineStaleEvalResult | null {
  if (!Number.isFinite(line.displayUntil)) {
    return null;
  }

  return {
    currentCloseTime,
    displayUntil: line.displayUntil as number,
    staleExpired: currentCloseTime > (line.displayUntil as number),
  };
}

export function applyTrendlineTouchAndBreakStats(args: {
  line: Trendline;
  touchEval?: TrendlineTouchEvalResult | null;
  breakEval?: TrendlineBreakEvalResult | null;
}): Trendline {
  const { line, touchEval, breakEval } = args;

  let next: Trendline = { ...line };

  if (touchEval?.touched) {
    next = {
      ...next,
      touchCount: next.touchCount + 1,
      lastTouchTime: touchEval.currentCloseTime,
    };
  }

  if (breakEval) {
    next = {
      ...next,
      breakStreak: breakEval.breakCandidate ? breakEval.breakCount : 0,
      lastBreakTime: breakEval.breakCandidate
        ? breakEval.currentCloseTime
        : next.lastBreakTime,
    };
  }

  return next;
}

export function applyTrendlineLifecycleInvalidation(
  args: ApplyTrendlineLifecycleInvalidationArgs
): Trendline {
  const { line, currentCloseTime, breakEval, staleEval } = args;

  if (line.state !== "ACTIVE") {
    return line;
  }

  if (breakEval?.breakConfirmed) {
    return {
      ...line,
      state: "INACTIVE",
      invalidReason: "break_confirmed",
      endTime: currentCloseTime,
    };
  }

  if (staleEval?.staleExpired) {
    return {
      ...line,
      state: "INACTIVE",
      invalidReason: "stale_expired",
      endTime: currentCloseTime,
    };
  }

  return line;
}
