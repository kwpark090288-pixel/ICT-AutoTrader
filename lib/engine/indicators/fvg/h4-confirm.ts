import type {
  H4CandidateConfirmEvalResult,
  H4CoreFvg,
} from "./types";

export function countH4SecondaryPasses(
  passF2: boolean,
  passF3: boolean,
  passF4: boolean
): number {
  return Number(passF2) + Number(passF3) + Number(passF4);
}

type EvaluateH4CoreFvgCandidateConfirmArgs = {
  candidate: H4CoreFvg;
  currentCloseTime: number;
  passF2: boolean;
  passF3: boolean;
  passF4: boolean;
};

export function evaluateH4CoreFvgCandidateConfirm(
  args: EvaluateH4CoreFvgCandidateConfirmArgs
): H4CandidateConfirmEvalResult {
  const { candidate, currentCloseTime, passF2, passF3, passF4 } = args;

  const secondaryPassCount = countH4SecondaryPasses(passF2, passF3, passF4);
  const isDueTime = currentCloseTime === candidate.confirmDueTime;

  return {
    isDueTime,
    passF1: candidate.passF1,
    secondaryPassCount,
    passConfirm:
      candidate.state === "CANDIDATE" &&
      isDueTime &&
      candidate.passF1 &&
      secondaryPassCount >= 2,
  };
}

export function applyH4CoreFvgCandidateConfirm(
  args: EvaluateH4CoreFvgCandidateConfirmArgs
): H4CoreFvg {
  const { candidate, currentCloseTime, passF2, passF3, passF4 } = args;

  if (candidate.state !== "CANDIDATE") {
    return candidate;
  }

  if (currentCloseTime !== candidate.confirmDueTime) {
    return candidate;
  }

  const evaluation = evaluateH4CoreFvgCandidateConfirm(args);

  if (evaluation.passConfirm) {
    return {
      ...candidate,
      state: "A_ACTIVE",
      passF2,
      passF3,
      passF4,
    };
  }

  return {
    ...candidate,
    state: "DELETED",
    passF2,
    passF3,
    passF4,
    invalidReason: "failed_confirm",
    endTime: currentCloseTime,
  };
}