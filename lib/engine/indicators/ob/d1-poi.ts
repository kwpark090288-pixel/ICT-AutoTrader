import { MAX_FORWARD_BARS } from "./constants";
import type {
  D1PoiOb,
  D1PoiObCandidateConfirmEvalResult,
  DetectedObZoneCandidate,
  ObContextDistanceEvalResult,
  ObDisplacementEvalResult,
  ObSweepRecoveryEvalResult,
  ObZoneHeightFilterEvalResult,
} from "./types";

const D1_BAR_DURATION_MS = 24 * 60 * 60 * 1000;

type CreateD1PoiObCandidateArgs = {
  id: string;
  symbol: string;
  zoneCandidate: DetectedObZoneCandidate | null;
  heightFilterEval: ObZoneHeightFilterEvalResult | null;
  structureTriggered: boolean;
  displacementEval: ObDisplacementEvalResult | null;
  contextEval: ObContextDistanceEvalResult | null;
};

type EvaluateD1PoiObCandidateConfirmArgs = {
  candidate: D1PoiOb;
  currentCloseTime: number;
  sweepRecoveryEval: ObSweepRecoveryEvalResult | null;
};

export function getD1PoiObConfirmDueTime(triggerTime: number): number {
  return triggerTime + D1_BAR_DURATION_MS;
}

export function getD1PoiObDisplayUntil(triggerTime: number): number {
  return triggerTime + MAX_FORWARD_BARS * D1_BAR_DURATION_MS;
}

export function createD1PoiObCandidate(
  args: CreateD1PoiObCandidateArgs
): D1PoiOb | null {
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
    type: "D1_POI_OB",
    tf: "D1",
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
    displayUntil: getD1PoiObDisplayUntil(zoneCandidate.triggerTime),
    confirmDueTime: getD1PoiObConfirmDueTime(zoneCandidate.triggerTime),
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

export function evaluateD1PoiObCandidateConfirm(
  args: EvaluateD1PoiObCandidateConfirmArgs
): D1PoiObCandidateConfirmEvalResult {
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

export function applyD1PoiObCandidateConfirm(
  args: EvaluateD1PoiObCandidateConfirmArgs
): D1PoiOb {
  const { candidate, currentCloseTime, sweepRecoveryEval } = args;

  if (candidate.state !== "CANDIDATE") {
    return candidate;
  }

  if (currentCloseTime !== candidate.confirmDueTime) {
    return candidate;
  }

  const evaluation = evaluateD1PoiObCandidateConfirm({
    candidate,
    currentCloseTime,
    sweepRecoveryEval,
  });

  if (evaluation.passConfirm) {
    return {
      ...candidate,
      state: "ACTIVE",
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
