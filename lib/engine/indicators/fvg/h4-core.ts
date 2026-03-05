import {
  H4_CONFIRM_DELAY_BARS,
  MAX_FORWARD_BARS,
} from "./constants";
import type {
  DetectedWickFvg,
  DisplacementEvalResult,
  H4CoreFvg,
} from "./types";

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

type CreateH4CoreFvgCandidateArgs = {
  id: string;
  symbol: string;
  detectedFvg: DetectedWickFvg | null;
  displacementEval?: DisplacementEvalResult | null;
};

export function getH4CoreConfirmDueTime(confTime: number): number {
  return confTime + H4_CONFIRM_DELAY_BARS * H4_BAR_DURATION_MS;
}

export function getH4CoreDisplayUntil(confTime: number): number {
  return confTime + MAX_FORWARD_BARS * H4_BAR_DURATION_MS;
}

export function createH4CoreFvgCandidate(
  args: CreateH4CoreFvgCandidateArgs
): H4CoreFvg | null {
  const { id, symbol, detectedFvg, displacementEval } = args;

  if (!detectedFvg) return null;
  if (detectedFvg.tf !== "H4") return null;

  const passF1 = Boolean(
    displacementEval &&
      displacementEval.confTime === detectedFvg.confTime &&
      displacementEval.passDisplacement
  );

  return {
    id,
    symbol: symbol.toUpperCase(),
    type: "H4_CORE_FVG",
    tf: "H4",
    dir: detectedFvg.dir,
    zone: {
      bottom: detectedFvg.zone.bottom,
      top: detectedFvg.zone.top,
      height: detectedFvg.zone.height,
    },
    confTime: detectedFvg.confTime,
    createdAt: detectedFvg.confTime,
    state: "CANDIDATE",
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getH4CoreDisplayUntil(detectedFvg.confTime),
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: detectedFvg.atrAtConf,
    confirmDueTime: getH4CoreConfirmDueTime(detectedFvg.confTime),
    passF1,
    passF2: false,
    passF3: false,
    passF4: false,
  };
}