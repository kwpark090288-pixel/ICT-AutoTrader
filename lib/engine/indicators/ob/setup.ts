import { compareLexicographic } from "../../tags";
import { INSIDE_OVERLAP_RATIO, MAX_FORWARD_BARS } from "./constants";
import type {
  D1PoiOb,
  DetectedObZoneCandidate,
  H4CoreOb,
  ObContextDistanceEvalResult,
  ObDisplacementEvalResult,
  ObSweepRecoveryEvalResult,
  ObZoneHeightFilterEvalResult,
  SetupOb,
  StructureState,
  Zone,
} from "./types";

const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

export type ObSetupTf = "H1" | "M30";
export type ObSetupParentPoi = D1PoiOb | H4CoreOb;

export interface ObSetupParentSelection {
  parentPoi: ObSetupParentPoi;
  insideOverlapLen: number;
  insideOverlapRatio: number;
  insideOverlapRatioBps: number;
}

type SelectObSetupParentArgs = {
  setupZone: Zone;
  d1PoiObs: readonly D1PoiOb[];
  h4CoreObs: readonly H4CoreOb[];
};

type CreateSetupObArgs = {
  id: string;
  symbol: string;
  zoneCandidate: DetectedObZoneCandidate | null;
  heightFilterEval: ObZoneHeightFilterEvalResult | null;
  structureTriggered: boolean;
  displacementEval: ObDisplacementEvalResult | null;
  sweepRecoveryEval: ObSweepRecoveryEvalResult | null;
  contextEval?: ObContextDistanceEvalResult | null;
  h4StructureAtConf: StructureState;
  d1PoiObs: readonly D1PoiOb[];
  h4CoreObs: readonly H4CoreOb[];
};

export function isObSetupTf(tf: string): tf is ObSetupTf {
  return tf === "H1" || tf === "M30";
}

export function isEligibleObSetupParent(
  parentPoi: ObSetupParentPoi
): boolean {
  if (parentPoi.type === "D1_POI_OB") {
    return parentPoi.state === "ACTIVE";
  }

  return parentPoi.state === "POI_ACTIVE";
}

export function computeObInsideOverlapLen(
  parentZone: Zone,
  setupZone: Zone
): number {
  return Math.max(
    0,
    Math.min(parentZone.top, setupZone.top) -
      Math.max(parentZone.bottom, setupZone.bottom)
  );
}

export function computeObInsideOverlapRatio(
  parentZone: Zone,
  setupZone: Zone
): number {
  const overlapLen = computeObInsideOverlapLen(parentZone, setupZone);
  const minHeight = Math.min(parentZone.height, setupZone.height);

  if (!(minHeight > 0)) {
    return 0;
  }

  return overlapLen / minHeight;
}

export function computeObInsideOverlapRatioBps(
  parentZone: Zone,
  setupZone: Zone
): number {
  return Math.floor(computeObInsideOverlapRatio(parentZone, setupZone) * 10000);
}

function selectBestSameLayerParent(
  setupZone: Zone,
  candidates: readonly ObSetupParentPoi[]
): ObSetupParentSelection | null {
  const eligible = candidates.filter(isEligibleObSetupParent);

  if (!eligible.length) {
    return null;
  }

  const scored = eligible.map((parentPoi) => ({
    parentPoi,
    insideOverlapLen: computeObInsideOverlapLen(parentPoi.zone, setupZone),
    insideOverlapRatio: computeObInsideOverlapRatio(parentPoi.zone, setupZone),
    insideOverlapRatioBps: computeObInsideOverlapRatioBps(
      parentPoi.zone,
      setupZone
    ),
  }));

  scored.sort((a, b) => {
    if (a.insideOverlapRatioBps !== b.insideOverlapRatioBps) {
      return b.insideOverlapRatioBps - a.insideOverlapRatioBps;
    }

    const aConfirmDue = a.parentPoi.confirmDueTime ?? Number.NEGATIVE_INFINITY;
    const bConfirmDue = b.parentPoi.confirmDueTime ?? Number.NEGATIVE_INFINITY;

    if (aConfirmDue !== bConfirmDue) {
      return bConfirmDue - aConfirmDue;
    }

    return compareLexicographic(a.parentPoi.id, b.parentPoi.id);
  });

  return scored[0];
}

export function selectObSetupParent(
  args: SelectObSetupParentArgs
): ObSetupParentSelection | null {
  const { setupZone, d1PoiObs, h4CoreObs } = args;

  const d1Eligible = d1PoiObs.filter(isEligibleObSetupParent);
  if (d1Eligible.length > 0) {
    return selectBestSameLayerParent(setupZone, d1Eligible);
  }

  const h4Eligible = h4CoreObs.filter(isEligibleObSetupParent);
  if (h4Eligible.length > 0) {
    return selectBestSameLayerParent(setupZone, h4Eligible);
  }

  return null;
}

export function getObSetupDisplayUntil(
  tf: ObSetupTf,
  triggerTime: number
): number {
  const durationMs = tf === "H1" ? H1_BAR_DURATION_MS : M30_BAR_DURATION_MS;
  return triggerTime + MAX_FORWARD_BARS * durationMs;
}

export function createSetupOb(args: CreateSetupObArgs): SetupOb | null {
  const {
    id,
    symbol,
    zoneCandidate,
    heightFilterEval,
    structureTriggered,
    displacementEval,
    sweepRecoveryEval,
    contextEval,
    h4StructureAtConf,
    d1PoiObs,
    h4CoreObs,
  } = args;

  if (!zoneCandidate) return null;
  if (!heightFilterEval || !heightFilterEval.passHeightFilter) return null;
  if (!isObSetupTf(heightFilterEval.tf)) return null;
  if (!structureTriggered) return null;

  if (
    !displacementEval ||
    !displacementEval.passDisplacement ||
    displacementEval.triggerTime !== zoneCandidate.triggerTime
  ) {
    return null;
  }

  if (!sweepRecoveryEval || !sweepRecoveryEval.passSweepRecovery) {
    return null;
  }

  const parentSelection = selectObSetupParent({
    setupZone: zoneCandidate.zone,
    d1PoiObs,
    h4CoreObs,
  });

  if (!parentSelection) {
    return null;
  }

  const passInside =
    parentSelection.insideOverlapRatio >= INSIDE_OVERLAP_RATIO;
  const passDirectionAlign =
    zoneCandidate.dir === parentSelection.parentPoi.dir;
  const passContextDist = Boolean(contextEval?.passContextDist);

  if (!passInside || !passDirectionAlign) {
    return null;
  }

  const hasH4MixedRiskTag = h4StructureAtConf === "MIXED";
  const tags = hasH4MixedRiskTag ? ["H4_MIXED_RISK"] : [];

  return {
    id,
    symbol: symbol.toUpperCase(),
    type: "SETUP_OB",
    tf: heightFilterEval.tf,
    dir: zoneCandidate.dir,
    zone: {
      bottom: zoneCandidate.zone.bottom,
      top: zoneCandidate.zone.top,
      height: zoneCandidate.zone.height,
    },
    triggerTime: zoneCandidate.triggerTime,
    createdAt: zoneCandidate.triggerTime,
    state: "ACTIVE",
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getObSetupDisplayUntil(
      heightFilterEval.tf,
      zoneCandidate.triggerTime
    ),
    atrAtTrigger: heightFilterEval.atrAtTrigger,
    passHeightFilter: true,
    passDisplacement: true,
    passSweepRecovery: true,
    passContextDist,
    sweepTargetType: sweepRecoveryEval.targetType ?? undefined,
    sweepTargetPrice: sweepRecoveryEval.linePrice ?? undefined,
    sweepTime: sweepRecoveryEval.sweepBarTime,
    recoveryTime: sweepRecoveryEval.recoveryBarTime,
    touchCount: 0,
    fullFillHit: false,
    tags,
    parentPoiId: parentSelection.parentPoi.id,
    parentPoiType: parentSelection.parentPoi.type,
    insideOverlapLen: parentSelection.insideOverlapLen,
    insideOverlapRatio: parentSelection.insideOverlapRatio,
    passInside: true,
    passDirectionAlign: true,
    h4StructureAtConf,
    hasH4MixedRiskTag,
    localOppChochAfterTouchOnly: true,
  };
}
