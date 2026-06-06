import { MAX_TOUCH_VALID } from "./constants";
import type {
  InvalidReason,
  ObInvalidationDecision,
  ObInvalidationFlags,
  Zone,
} from "./types";

type EvaluateD1PoiObInvalidationFlagsArgs = {
  fullFillHit?: boolean;
  oppositeChoch?: boolean;
  prunedByLimit?: boolean;
};

type EvaluateH4CoreObInvalidationFlagsArgs = {
  fullFillHit?: boolean;
  oppositeChoch?: boolean;
  touchCount?: number;
  prunedByLimit?: boolean;
};

type EvaluateSetupObInvalidationFlagsArgs = {
  fullFillHit?: boolean;
  localOppositeChoch?: boolean;
  h4OppositeChochAffectsParentChain?: boolean;
  touchCount?: number;
  prunedByLimit?: boolean;
  localOppChochAfterTouchOnly?: boolean;
};

type EvaluateObFullFillHitArgs = {
  dir: "BULL" | "BEAR";
  zone: Zone;
  wickHigh: number;
  wickLow: number;
};

export function evaluateObFullFillHit(
  args: EvaluateObFullFillHitArgs
): boolean {
  const { dir, zone, wickHigh, wickLow } = args;

  if (dir === "BULL") {
    return wickLow <= zone.bottom;
  }

  return wickHigh >= zone.top;
}

export function resolveObInvalidationReasonWithPriority(
  flags: ObInvalidationFlags
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

export function resolveObInvalidationDecision(
  flags: ObInvalidationFlags
): ObInvalidationDecision {
  const invalidReason = resolveObInvalidationReasonWithPriority(flags);

  return {
    invalidated: invalidReason !== null,
    invalidReason,
  };
}

export function evaluateD1PoiObInvalidationFlags(
  args: EvaluateD1PoiObInvalidationFlagsArgs
): ObInvalidationFlags {
  const { fullFillHit, oppositeChoch, prunedByLimit } = args;

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated: Boolean(oppositeChoch),
    touchInvalidated: false,
    pruneInvalidated: Boolean(prunedByLimit),
  };
}

export function evaluateH4CoreObInvalidationFlags(
  args: EvaluateH4CoreObInvalidationFlagsArgs
): ObInvalidationFlags {
  const { fullFillHit, oppositeChoch, touchCount, prunedByLimit } = args;

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated: Boolean(oppositeChoch),
    touchInvalidated: (touchCount ?? 0) > MAX_TOUCH_VALID,
    pruneInvalidated: Boolean(prunedByLimit),
  };
}

export function evaluateSetupObInvalidationFlags(
  args: EvaluateSetupObInvalidationFlagsArgs
): ObInvalidationFlags {
  const {
    fullFillHit,
    localOppositeChoch,
    h4OppositeChochAffectsParentChain,
    touchCount,
    prunedByLimit,
    localOppChochAfterTouchOnly,
  } = args;

  const hasTouched = (touchCount ?? 0) >= 1;

  const localOppositeChochInvalidated = Boolean(localOppositeChoch) &&
    (!localOppChochAfterTouchOnly || hasTouched);

  const h4OppositeChochInvalidated = Boolean(
    h4OppositeChochAffectsParentChain
  );

  return {
    fullFillInvalidated: Boolean(fullFillHit),
    oppositeChochInvalidated:
      localOppositeChochInvalidated || h4OppositeChochInvalidated,
    touchInvalidated: (touchCount ?? 0) > MAX_TOUCH_VALID,
    pruneInvalidated: Boolean(prunedByLimit),
  };
}
