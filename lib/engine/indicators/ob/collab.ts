import { compareLexicographic, uniqueLexicographicTags } from "../../tags";
import type {
  AnyObBox,
  ObCollabBestMatch,
  ObFvgCollabEvalResult,
  Zone,
} from "./types";
import type { RouterRawPoi } from "../../../router/raw-event";
import type {
  D1PoiFvg as FvgD1PoiFvg,
  H4CoreFvg as FvgH4CoreFvg,
  SetupFvg as FvgSetupFvg,
  StackZone as FvgStackZone,
} from "../fvg/types";

type RuntimeFvgPoi = Extract<RouterRawPoi, { kind: "FVG" }>;

export type ObFvgCollabSource =
  | FvgD1PoiFvg
  | FvgH4CoreFvg
  | FvgSetupFvg
  | FvgStackZone
  | RuntimeFvgPoi;

export type EligibleFvgForObCollab =
  | FvgD1PoiFvg
  | FvgH4CoreFvg
  | FvgSetupFvg
  | RuntimeFvgPoi;

const COLLAB_FVG_INSIDE_TAG = "COLLAB_FVG_INSIDE_0.20";
const COLLAB_FVG_OVERLAP_TAG = "COLLAB_FVG_OVERLAP_0.30";

type ObFvgCollabCandidate = {
  targetId: string;
  overlapRatio: number;
  confTime: number;
  tag: string;
};

export function isEligibleFvgForObCollab(
  fvg: ObFvgCollabSource
): fvg is EligibleFvgForObCollab {
  if ("kind" in fvg && fvg.kind === "FVG") {
    return (
      (fvg.type === "D1_POI_FVG" && fvg.state === "ACTIVE") ||
      (fvg.type === "H4_CORE_FVG" && fvg.state === "A_ACTIVE") ||
      (fvg.type === "SETUP_FVG" && fvg.state === "ACTIVE")
    );
  }

  if (fvg.type === "D1_POI_FVG") {
    return fvg.state === "ACTIVE";
  }

  if (fvg.type === "H4_CORE_FVG") {
    return fvg.state === "A_ACTIVE";
  }

  if (fvg.type === "SETUP_FVG") {
    return fvg.state === "ACTIVE";
  }

  return false;
}

function getFvgCollabConfTime(fvg: EligibleFvgForObCollab): number {
  if ("kind" in fvg && fvg.kind === "FVG") {
    if (typeof fvg.confTime === "string") {
      const parsed = Date.parse(fvg.confTime);
      return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    }

    return Number.NEGATIVE_INFINITY;
  }

  return fvg.confTime;
}

export function computeObFvgOverlapLen(obZone: Zone, fvgZone: Zone): number {
  return Math.max(
    0,
    Math.min(obZone.top, fvgZone.top) - Math.max(obZone.bottom, fvgZone.bottom)
  );
}

export function computeObFvgOverlapRatio(obZone: Zone, fvgZone: Zone): number {
  const overlapLen = computeObFvgOverlapLen(obZone, fvgZone);
  const minHeight = Math.min(obZone.height, fvgZone.height);

  if (!(minHeight > 0)) {
    return 0;
  }

  return overlapLen / minHeight;
}

export function getObFvgCollabTag(overlapRatio: number): string | null {
  if (overlapRatio >= 0.30) {
    return COLLAB_FVG_OVERLAP_TAG;
  }

  if (overlapRatio >= 0.20) {
    return COLLAB_FVG_INSIDE_TAG;
  }

  return null;
}

function selectBestObFvgCollabCandidate(
  candidates: readonly ObFvgCollabCandidate[]
): ObFvgCollabCandidate | null {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((a, b) => {
    if (a.overlapRatio !== b.overlapRatio) {
      return b.overlapRatio - a.overlapRatio;
    }

    if (a.confTime !== b.confTime) {
      return b.confTime - a.confTime;
    }

    return compareLexicographic(a.targetId, b.targetId);
  })[0];
}

function buildBestCollab(candidate: ObFvgCollabCandidate): ObCollabBestMatch {
  return {
    kind: "OB∩FVG",
    targetId: candidate.targetId,
    ratioOrDist: candidate.overlapRatio,
    tag: candidate.tag,
  };
}

export function evaluateObFvgCollab(
  ob: AnyObBox,
  fvgs: readonly ObFvgCollabSource[]
): ObFvgCollabEvalResult {
  const tags: string[] = [];
  const candidates: ObFvgCollabCandidate[] = [];

  for (const fvg of fvgs) {
    if (!isEligibleFvgForObCollab(fvg)) {
      continue;
    }

    if (ob.symbol.toUpperCase() !== fvg.symbol.toUpperCase()) {
      continue;
    }

    if (ob.dir !== fvg.dir) {
      continue;
    }

    const overlapRatio = computeObFvgOverlapRatio(ob.zone, fvg.zone);
    const tag = getObFvgCollabTag(overlapRatio);

    if (!tag) {
      continue;
    }

    tags.push(tag);
    candidates.push({
      targetId: fvg.id,
      overlapRatio,
      confTime: getFvgCollabConfTime(fvg),
      tag,
    });
  }

  const best = selectBestObFvgCollabCandidate(candidates);

  if (!best) {
    return {
      tags: [],
    };
  }

  return {
    tags: uniqueLexicographicTags(tags),
    bestCollab: buildBestCollab(best),
  };
}

