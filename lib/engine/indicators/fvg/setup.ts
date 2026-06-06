import {
  FVG_SETUP_TFS,
  INSIDE_OVERLAP_RATIO,
  MAX_FORWARD_BARS,
  MIN_ZONE_HEIGHT_ATR,
} from "./constants";
import type {
  D1PoiFvg,
  DetectedWickFvg,
  DisplacementEvalResult,
  H4CoreFvg,
  SetupFvg,
  StructureState,
  Zone,
} from "./types";

const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

export type SetupParentPoi = D1PoiFvg | H4CoreFvg;
export type SetupTf = "H1" | "M30";
export type SetupParentLayer = "D1" | "H4";

export interface SetupParentMatch {
  parent: SetupParentPoi;
  layer: SetupParentLayer;
  insideOverlapLen: number;
  insideOverlapRatio: number;
}

type CreateSetupFvgArgs = {
  id: string;
  symbol: string;
  parentPoi: SetupParentPoi;
  supportingParentIds?: readonly string[];
  tags?: readonly string[];
  detectedFvg: DetectedWickFvg | null;
  displacementEval?: DisplacementEvalResult | null;
  h4StructureAtConf: StructureState;
};

type CreateSetupFvgFromParentPoolArgs = {
  id: string;
  symbol: string;
  detectedFvg: DetectedWickFvg | null;
  displacementEval?: DisplacementEvalResult | null;
  h4StructureAtConf: StructureState;
  parents: readonly SetupParentPoi[];
};

export function isSetupTf(tf: string): tf is SetupTf {
  return (FVG_SETUP_TFS as readonly string[]).includes(tf);
}

export function isEligibleSetupParentPoi(parentPoi: SetupParentPoi): boolean {
  if (parentPoi.type === "D1_POI_FVG") {
    return parentPoi.state === "ACTIVE";
  }

  return parentPoi.state === "A_ACTIVE";
}

export function computeInsideOverlapLen(
  parentZone: Zone,
  setupZone: Zone
): number {
  return Math.max(
    0,
    Math.min(parentZone.top, setupZone.top) -
      Math.max(parentZone.bottom, setupZone.bottom)
  );
}

export function computeInsideOverlapRatio(
  parentZone: Zone,
  setupZone: Zone
): number {
  const overlapLen = computeInsideOverlapLen(parentZone, setupZone);
  const minHeight = Math.min(parentZone.height, setupZone.height);

  if (!(minHeight > 0)) {
    return 0;
  }

  return overlapLen / minHeight;
}

export function getSetupDisplayUntil(tf: SetupTf, confTime: number): number {
  const tfDurationMs =
    tf === "H1" ? H1_BAR_DURATION_MS : M30_BAR_DURATION_MS;

  return confTime + MAX_FORWARD_BARS * tfDurationMs;
}

export function getSetupParentLayer(parentPoi: SetupParentPoi): SetupParentLayer {
  return parentPoi.type === "D1_POI_FVG" ? "D1" : "H4";
}

export function isValidSetupParentMatch(
  parentPoi: SetupParentPoi,
  detectedFvg: DetectedWickFvg | null
): parentPoi is SetupParentPoi {
  if (!detectedFvg) return false;
  if (!isSetupTf(detectedFvg.tf)) return false;
  if (!isEligibleSetupParentPoi(parentPoi)) return false;
  if (detectedFvg.dir !== parentPoi.dir) return false;

  return (
    computeInsideOverlapRatio(parentPoi.zone, detectedFvg.zone) >=
    INSIDE_OVERLAP_RATIO
  );
}

export function listValidSetupParentMatches(
  parents: readonly SetupParentPoi[],
  detectedFvg: DetectedWickFvg | null
): SetupParentMatch[] {
  if (!detectedFvg) {
    return [];
  }

  return parents
    .filter((parentPoi) => isValidSetupParentMatch(parentPoi, detectedFvg))
    .map((parentPoi) => ({
      parent: parentPoi,
      layer: getSetupParentLayer(parentPoi),
      insideOverlapLen: computeInsideOverlapLen(parentPoi.zone, detectedFvg.zone),
      insideOverlapRatio: computeInsideOverlapRatio(parentPoi.zone, detectedFvg.zone),
    }));
}

function compareSetupParentMatches(
  a: SetupParentMatch,
  b: SetupParentMatch
): number {
  if (a.insideOverlapRatio !== b.insideOverlapRatio) {
    return b.insideOverlapRatio - a.insideOverlapRatio;
  }

  if (a.parent.confTime !== b.parent.confTime) {
    return b.parent.confTime - a.parent.confTime;
  }

  return a.parent.id.localeCompare(b.parent.id);
}

export function selectCanonicalSetupParentMatch(
  matches: readonly SetupParentMatch[]
): SetupParentMatch | null {
  if (!matches.length) {
    return null;
  }

  const d1Matches = matches.filter((match) => match.layer === "D1");
  const pool = d1Matches.length ? d1Matches : matches.filter((match) => match.layer === "H4");

  if (!pool.length) {
    return null;
  }

  return [...pool].sort(compareSetupParentMatches)[0] ?? null;
}

function buildSetupSupportingTags(
  canonicalLayer: SetupParentLayer,
  supportingParentIds: readonly string[]
): string[] | undefined {
  if (!supportingParentIds.length) {
    return undefined;
  }

  return canonicalLayer === "D1"
    ? ["PARENT_D1_PRIMARY", "PARENT_H4_SUPPORT"]
    : ["PARENT_H4_PRIMARY"];
}

export function createSetupFvg(args: CreateSetupFvgArgs): SetupFvg | null {
  const {
    id,
    symbol,
    parentPoi,
    supportingParentIds,
    tags,
    detectedFvg,
    displacementEval,
    h4StructureAtConf,
  } = args;

  if (!detectedFvg) return null;
  if (!isSetupTf(detectedFvg.tf)) return null;
  if (!isEligibleSetupParentPoi(parentPoi)) return null;

  const passZoneHeight =
    detectedFvg.zone.height >= detectedFvg.atrAtConf * MIN_ZONE_HEIGHT_ATR;

  const insideOverlapLen = computeInsideOverlapLen(
    parentPoi.zone,
    detectedFvg.zone
  );
  const insideOverlapRatio = computeInsideOverlapRatio(
    parentPoi.zone,
    detectedFvg.zone
  );

  const passInside = insideOverlapRatio >= INSIDE_OVERLAP_RATIO;
  const passDirectionAlign = detectedFvg.dir === parentPoi.dir;
  const passH4StructureFilter = h4StructureAtConf !== "MIXED";
  const passDisplacement = Boolean(
    displacementEval &&
      displacementEval.confTime === detectedFvg.confTime &&
      displacementEval.passDisplacement
  );

  if (
    !passZoneHeight ||
    !passInside ||
    !passDirectionAlign ||
    !passH4StructureFilter ||
    !passDisplacement
  ) {
    return null;
  }

  return {
    id,
    symbol: symbol.toUpperCase(),
    type: "SETUP_FVG",
    tf: detectedFvg.tf,
    dir: detectedFvg.dir,
    zone: {
      bottom: detectedFvg.zone.bottom,
      top: detectedFvg.zone.top,
      height: detectedFvg.zone.height,
    },
    confTime: detectedFvg.confTime,
    createdAt: detectedFvg.confTime,
    state: "ACTIVE",
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getSetupDisplayUntil(
      detectedFvg.tf,
      detectedFvg.confTime
    ),
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: detectedFvg.atrAtConf,
    parentPoiId: parentPoi.id,
    parentPoiType: parentPoi.type,
    ...(supportingParentIds && supportingParentIds.length
      ? { supportingParentIds: [...supportingParentIds] }
      : {}),
    ...(tags && tags.length ? { tags: [...tags] } : {}),
    insideOverlapLen,
    insideOverlapRatio,
    passInside,
    passDirectionAlign,
    h4StructureAtConf,
    passH4StructureFilter,
    passDisplacement,
  };
}

export function createSetupFvgFromParentPool(
  args: CreateSetupFvgFromParentPoolArgs
): SetupFvg | null {
  const { parents, detectedFvg } = args;
  const matches = listValidSetupParentMatches(parents, detectedFvg);
  const canonical = selectCanonicalSetupParentMatch(matches);

  if (!canonical) {
    return null;
  }

  const supportingParentIds = matches
    .filter((match) => match.parent.id !== canonical.parent.id)
    .map((match) => match.parent.id)
    .sort((a, b) => a.localeCompare(b));

  return createSetupFvg({
    ...args,
    parentPoi: canonical.parent,
    supportingParentIds,
    tags: buildSetupSupportingTags(canonical.layer, supportingParentIds),
  });
}
