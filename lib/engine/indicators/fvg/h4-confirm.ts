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

function latchH4CoreConfirmFlags(
  candidate: H4CoreFvg,
  passF2: boolean,
  passF3: boolean,
  passF4: boolean
) {
  return {
    passF2: candidate.passF2 || passF2,
    passF3: candidate.passF3 || passF3,
    passF4: candidate.passF4 || passF4,
  };
}

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

  const latched = latchH4CoreConfirmFlags(candidate, passF2, passF3, passF4);

  if (currentCloseTime !== candidate.confirmDueTime) {
    if (
      latched.passF2 === candidate.passF2 &&
      latched.passF3 === candidate.passF3 &&
      latched.passF4 === candidate.passF4
    ) {
      return candidate;
    }

    return {
      ...candidate,
      ...latched,
    };
  }

  const evaluation = evaluateH4CoreFvgCandidateConfirm({
    ...args,
    ...latched,
  });

  if (evaluation.passConfirm) {
    return {
      ...candidate,
      state: "A_ACTIVE",
      ...latched,
    };
  }

  return {
    ...candidate,
    state: "DELETED",
    ...latched,
    invalidReason: "failed_confirm",
    endTime: currentCloseTime,
  };
}
