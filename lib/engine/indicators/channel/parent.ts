import type { RouterRawPoi } from "../../../router/raw-event";
import type {
  ChannelDir,
  ChannelParentPoiContext,
} from "./types";

function isActiveChannelParentCandidate(
  poi: RouterRawPoi,
  dir: "BULL" | "BEAR"
): boolean {
  if (poi.dir !== dir) {
    return false;
  }

  if (poi.kind === "OB") {
    return (
      (poi.type === "D1_POI_OB" && poi.state === "ACTIVE") ||
      (poi.type === "H4_CORE_OB" && poi.state === "POI_ACTIVE")
    );
  }

  if (poi.kind === "FVG") {
    return (
      (poi.type === "D1_POI_FVG" && poi.state === "ACTIVE") ||
      (poi.type === "H4_CORE_FVG" && poi.state === "A_ACTIVE")
    );
  }

  return false;
}

export function getChannelParentDir(dir: ChannelDir): "BULL" | "BEAR" {
  return dir === "UP" ? "BULL" : "BEAR";
}

export function listActiveChannelParentCandidates(
  runtimePois: readonly RouterRawPoi[],
  dir: ChannelDir
): RouterRawPoi[] {
  const parentDir = getChannelParentDir(dir);

  return runtimePois.filter((poi) => isActiveChannelParentCandidate(poi, parentDir));
}

export function extractChannelParentBoundaryPrice(
  parent: RouterRawPoi
): number | null {
  if (!("zone" in parent) || !parent.zone) {
    return null;
  }

  return parent.dir === "BULL" ? parent.zone.bottom : parent.zone.top;
}

export function toChannelParentPoiContexts(
  parents: readonly RouterRawPoi[]
): ChannelParentPoiContext[] {
  const out: ChannelParentPoiContext[] = [];

  for (const parent of parents) {
    if (!("zone" in parent) || !parent.zone) {
      continue;
    }

    const boundaryPrice = extractChannelParentBoundaryPrice(parent);
    if (!Number.isFinite(boundaryPrice)) {
      continue;
    }

    out.push({
      id: parent.id,
      boundaryPrice: boundaryPrice as number,
      zone: {
        bottom: parent.zone.bottom,
        top: parent.zone.top,
        height: parent.zone.top - parent.zone.bottom,
      },
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildReferencedChannelParentIds(
  parents: readonly RouterRawPoi[]
): string[] {
  return [...new Set(parents.map((parent) => parent.id))].sort((a, b) =>
    a.localeCompare(b)
  );
}
