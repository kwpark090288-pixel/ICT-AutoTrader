import type {
  FvgInvalidationDecision,
  FvgInvalidationFlags,
  InvalidReason,
} from "./types";

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