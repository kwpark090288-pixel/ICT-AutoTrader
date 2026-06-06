import type {
  RouterCandidate,
  RouterOpenIntentPoiTier,
  RouterSendOpenPayload,
} from "./types";
import { buildRouterSendOpenPayload } from "./contracts";

export function getRouterPoiTierRank(
  poiTier: RouterOpenIntentPoiTier
): number {
  if (poiTier === "H1_SETUP" || poiTier === "M30_SETUP") {
    return 3;
  }

  if (poiTier === "H4_CORE") {
    return 2;
  }

  if (poiTier === "D1_POI") {
    return 1;
  }

  return 0;
}

export function computeRouterCandidateDist(
  candidate: RouterCandidate
): number | null {
  const boundary = candidate.signal.entryBoundaryPrice;
  const extreme = candidate.priceExtreme;

  if (!Number.isFinite(boundary) || !Number.isFinite(extreme)) {
    return null;
  }

  return Math.abs(extreme - boundary);
}

function parseIsoTime(value: string): number {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

export function compareRouterBest1Candidates(
  a: RouterCandidate,
  b: RouterCandidate
): number {
  const distA = computeRouterCandidateDist(a) ?? Number.POSITIVE_INFINITY;
  const distB = computeRouterCandidateDist(b) ?? Number.POSITIVE_INFINITY;

  if (distA !== distB) {
    return distA - distB;
  }

  const rankA = getRouterPoiTierRank(a.signal.poiTier === "SETUP"
    ? (a.tf === "H1" ? "H1_SETUP" : a.tf === "M30" ? "M30_SETUP" : "OTHER")
    : (a.signal.poiTier as RouterOpenIntentPoiTier)
  );

  const rankB = getRouterPoiTierRank(b.signal.poiTier === "SETUP"
    ? (b.tf === "H1" ? "H1_SETUP" : b.tf === "M30" ? "M30_SETUP" : "OTHER")
    : (b.signal.poiTier as RouterOpenIntentPoiTier)
  );

  if (rankA !== rankB) {
    return rankB - rankA;
  }

  const confA = parseIsoTime(a.poiConfTime);
  const confB = parseIsoTime(b.poiConfTime);

  if (confA !== confB) {
    return confB - confA;
  }

  return a.signal.poiId.localeCompare(b.signal.poiId);
}

export function selectBest1OpenCandidate(
  candidates: readonly RouterCandidate[]
): RouterCandidate | null {
  const eligible = candidates.filter(
    (c) => c.policy.decision === "ALLOW"
  );

  if (!eligible.length) {
    return null;
  }

  return [...eligible].sort(compareRouterBest1Candidates)[0];
}

export function buildBest1SendOpenPayload(
  candidates: readonly RouterCandidate[]
): RouterSendOpenPayload | null {
  const best = selectBest1OpenCandidate(candidates);
  if (!best) {
    return null;
  }

  return buildRouterSendOpenPayload(best);
}
