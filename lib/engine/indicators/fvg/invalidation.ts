import type {
  Dir,
  InvalidReason,
  Zone,
  FvgInvalidationDecision,
  FvgInvalidationFlags,
} from "./types";
import { MAX_TOUCH_VALID } from "./constants";

type EvaluateH4CoreFvgInvalidationFlagsArgs = {
  fullFillHit?: boolean;
  oppositeChoch?: boolean;
  touchCount?: number;
  prunedByLimit?: boolean;
};

type EvaluateSetupFvgInvalidationFlagsArgs = {
  fullFillHit?: boolean;
  h4OppositeChochAffectsParentChain?: boolean;
  touchCount?: number;
  prunedByLimit?: boolean;
};

type EvaluateFvgFullFillHitArgs = {
  dir: Dir;
  zone: Zone;
  wickHigh: number;
  wickLow: number;
};

export function resolveFvgInvalidationReasonWithPriority(
  flags: FvgInvalidationFlags
): InvalidReason | null {
  if (flags.fullFillInvalidated) {
    return "full_fill";
  }

  if (flags.oppositeChochInvalidated) {
    return "opposite_choch";
  }

  if (flags.touchInvalidated) {
    return "touch_3";
  }

  if (flags.pruneInvalidated) {
    return "pruned_by_limit";
  }

  return null;
}

export function resolveFvgInvalidationDecision(
  flags: FvgInvalidationFlags
): FvgInvalidationDecision {
  const invalidReason = resolveFvgInvalidationReasonWithPriority(flags);

  return {
    invalidated: invalidReason !== null,
    invalidReason,
  };
}

export function evaluateFvgFullFillHit(
  args: EvaluateFvgFullFillHitArgs
): boolean {
  const { dir, zone, wickHigh, wickLow } = args;

  if (!(zone.top > zone.bottom)) {
    return false;
  }

  if (!(wickHigh >= wickLow)) {
    return false;
  }

  return dir === "BULL" ? wickLow <= zone.bottom : wickHigh >= zone.top;
}

export function evaluateH4CoreFvgInvalidationFlags(
  args: EvaluateH4CoreFvgInvalidationFlagsArgs
): FvgInvalidationFlags {
  const { fullFillHit, oppositeChoch, touchCount, prunedByLimit } = args;

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated: Boolean(oppositeChoch),
    touchInvalidated: (touchCount ?? 0) > MAX_TOUCH_VALID,
    pruneInvalidated: Boolean(prunedByLimit),
  };
}

export function evaluateSetupFvgInvalidationFlags(
  args: EvaluateSetupFvgInvalidationFlagsArgs
): FvgInvalidationFlags {
  const {
    fullFillHit,
    h4OppositeChochAffectsParentChain,
    touchCount,
    prunedByLimit,
  } = args;

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated: Boolean(h4OppositeChochAffectsParentChain),
    touchInvalidated: (touchCount ?? 0) > MAX_TOUCH_VALID,
    pruneInvalidated: Boolean(prunedByLimit),
  };
}
