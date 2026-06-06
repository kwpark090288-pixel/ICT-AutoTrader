import { MAX_FORWARD_BARS } from "./constants";
import type {
  DetectedObZoneCandidate,
  H4CoreOb,
  H4CoreObCandidateConfirmEvalResult,
  ObContextDistanceEvalResult,
  ObDisplacementEvalResult,
  ObSweepRecoveryEvalResult,
  ObZoneHeightFilterEvalResult,
} from "./types";

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

type CreateH4CoreObCandidateArgs = {
  id: string;
  symbol: string;
  zoneCandidate: DetectedObZoneCandidate | null;
  heightFilterEval: ObZoneHeightFilterEvalResult | null;
  structureTriggered: boolean;
  displacementEval: ObDisplacementEvalResult | null;
  contextEval: ObContextDistanceEvalResult | null;
};

type EvaluateH4CoreObCandidateConfirmArgs = {
  candidate: H4CoreOb;
  currentCloseTime: number;
  sweepRecoveryEval: ObSweepRecoveryEvalResult | null;
};

export function getH4CoreObConfirmDueTime(triggerTime: number): number {
  return triggerTime + H4_BAR_DURATION_MS;
}

export function getH4CoreObDisplayUntil(triggerTime: number): number {
  return triggerTime + MAX_FORWARD_BARS * H4_BAR_DURATION_MS;
}

export function createH4CoreObCandidate(
  args: CreateH4CoreObCandidateArgs
): H4CoreOb | null {
  const {
    id,
    symbol,
    zoneCandidate,
    heightFilterEval,
    structureTriggered,
    displacementEval,
    contextEval,
  } = args;

  if (!zoneCandidate) return null;
  if (zoneCandidate.dir !== "BULL" && zoneCandidate.dir !== "BEAR") return null;

  if (!heightFilterEval || !heightFilterEval.passHeightFilter) {
    return null;
  }

  if (!structureTriggered) {
    return null;
  }

  if (!displacementEval || !displacementEval.passDisplacement) {
    return null;
  }

  if (!contextEval || !contextEval.passContextDist) {
    return null;
  }

  return {
    id,
    symbol: symbol.toUpperCase(),
    type: "H4_CORE_OB",
    tf: "H4",
    dir: zoneCandidate.dir,
    zone: {
      bottom: zoneCandidate.zone.bottom,
      top: zoneCandidate.zone.top,
      height: zoneCandidate.zone.height,
    },
    triggerTime: zoneCandidate.triggerTime,
    createdAt: zoneCandidate.triggerTime,
    state: "CANDIDATE",
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getH4CoreObDisplayUntil(zoneCandidate.triggerTime),
    confirmDueTime: getH4CoreObConfirmDueTime(zoneCandidate.triggerTime),
    atrAtTrigger: heightFilterEval.atrAtTrigger,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: false,
    passContextDist: true,
    touchCount: 0,
    fullFillHit: false,
    tags: [],
  };
}

export function evaluateH4CoreObCandidateConfirm(
  args: EvaluateH4CoreObCandidateConfirmArgs
): H4CoreObCandidateConfirmEvalResult {
  const { candidate, currentCloseTime, sweepRecoveryEval } = args;

  const isDueTime =
    candidate.state === "CANDIDATE" &&
    currentCloseTime === candidate.confirmDueTime;

  const passSweepRecovery = Boolean(sweepRecoveryEval?.passSweepRecovery);

  return {
    isDueTime,
    passSweepRecovery,
    passConfirm: isDueTime && passSweepRecovery,
  };
}

export function applyH4CoreObCandidateConfirm(
  args: EvaluateH4CoreObCandidateConfirmArgs
): H4CoreOb {
  const { candidate, currentCloseTime, sweepRecoveryEval } = args;

  if (candidate.state !== "CANDIDATE") {
    return candidate;
  }

  if (currentCloseTime !== candidate.confirmDueTime) {
    return candidate;
  }

  const evaluation = evaluateH4CoreObCandidateConfirm({
    candidate,
    currentCloseTime,
    sweepRecoveryEval,
  });

  if (evaluation.passConfirm) {
    return {
      ...candidate,
      state: "POI_ACTIVE",
      passSweepRecovery: true,
    };
  }

  return {
    ...candidate,
    state: "DELETED",
    passSweepRecovery: false,
    invalidReason: "failed_confirm",
    endTime: currentCloseTime,
  };
}
