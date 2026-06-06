import type { RouterRawPoi } from "../../../router/raw-event";
import { compareLexicographic, uniqueLexicographicTags } from "../../tags";
import { evaluateObContextDistanceFilter } from "./filters";
import type {
  AnyObBox,
  Dir,
  ObCollabBestMatch,
  ObContextDistanceEvalResult,
  Zone,
} from "./types";

type ObRuntimeContextPoi = Extract<
  RouterRawPoi,
  { kind: "CHANNEL" | "TRENDLINE" }
>;

type ObContextSelection = {
  source: "CHANNEL" | "TRENDLINE";
  targetId: string;
  distanceRaw: number;
  distanceAtr: number;
  contextTime: number;
  tag: "COLLAB_CONTEXT_OK_0.25" | "COLLAB_CONTEXT_TIGHT_0.10";
};

type EvaluateObContextAtTimeArgs = {
  symbol: string;
  dir: Dir;
  zone: Zone;
  atrAtEval: number;
  tEval: number;
  runtimePois: readonly RouterRawPoi[];
};

function toIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function getPoiContextTime(poi: ObRuntimeContextPoi): number {
  if (Number.isFinite(poi.updatedAtMs)) {
    return poi.updatedAtMs as number;
  }

  const parsedConfTime = poi.confTime ? Date.parse(poi.confTime) : Number.NaN;
  if (Number.isFinite(parsedConfTime)) {
    return parsedConfTime;
  }

  return Number.NEGATIVE_INFINITY;
}

function computeDistanceFromPriceToZone(zone: Zone, price: number): number {
  if (!Number.isFinite(price)) {
    return Number.NaN;
  }

  if (price >= zone.bottom && price <= zone.top) {
    return 0;
  }

  return Math.min(
    Math.abs(price - zone.bottom),
    Math.abs(price - zone.top)
  );
}

function getRoleMatchedContextPois(
  runtimePois: readonly RouterRawPoi[],
  dir: Dir
): ObRuntimeContextPoi[] {
  return runtimePois.filter(
    (poi): poi is ObRuntimeContextPoi =>
      (poi.kind === "CHANNEL" || poi.kind === "TRENDLINE") && poi.dir === dir
  );
}

function buildChannelSelectionCandidate(
  poi: Extract<RouterRawPoi, { kind: "CHANNEL" }>,
  zone: Zone,
  atrAtEval: number,
  openTime: string
): ObContextSelection | null {
  const channelPrice =
    poi.dir === "BULL" ? poi.lowerBandAt(openTime) : poi.upperBandAt(openTime);
  const distanceRaw = computeDistanceFromPriceToZone(zone, channelPrice);

  if (!Number.isFinite(distanceRaw)) {
    return null;
  }

  const distanceAtr = distanceRaw / atrAtEval;

  if (distanceAtr > 0.25) {
    return null;
  }

  return {
    source: "CHANNEL",
    targetId: poi.id,
    distanceRaw,
    distanceAtr,
    contextTime: getPoiContextTime(poi),
    tag:
      distanceAtr <= 0.1
        ? "COLLAB_CONTEXT_TIGHT_0.10"
        : "COLLAB_CONTEXT_OK_0.25",
  };
}

function buildTrendlineSelectionCandidate(
  poi: Extract<RouterRawPoi, { kind: "TRENDLINE" }>,
  zone: Zone,
  atrAtEval: number,
  openTime: string
): ObContextSelection | null {
  const linePrice = poi.linePriceAt(openTime);
  const distanceRaw = computeDistanceFromPriceToZone(zone, linePrice);

  if (!Number.isFinite(distanceRaw)) {
    return null;
  }

  const distanceAtr = distanceRaw / atrAtEval;

  if (distanceAtr > 0.25) {
    return null;
  }

  return {
    source: "TRENDLINE",
    targetId: poi.id,
    distanceRaw,
    distanceAtr,
    contextTime: getPoiContextTime(poi),
    tag:
      distanceAtr <= 0.1
        ? "COLLAB_CONTEXT_TIGHT_0.10"
        : "COLLAB_CONTEXT_OK_0.25",
  };
}

function compareObContextSelection(
  a: ObContextSelection,
  b: ObContextSelection
): number {
  if (a.distanceAtr !== b.distanceAtr) {
    return a.distanceAtr - b.distanceAtr;
  }

  if (a.contextTime !== b.contextTime) {
    return b.contextTime - a.contextTime;
  }

  return compareLexicographic(a.targetId, b.targetId);
}

function selectBestContextCandidate(
  candidates: readonly ObContextSelection[]
): ObContextSelection | null {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort(compareObContextSelection)[0];
}

export function evaluateObContextSelectionAtTime(
  args: EvaluateObContextAtTimeArgs
): ObContextSelection | null {
  const { dir, zone, atrAtEval, tEval, runtimePois } = args;

  if (!Number.isFinite(atrAtEval) || atrAtEval <= 0) {
    return null;
  }

  const openTime = toIsoUtcSecond(tEval);
  const roleMatched = getRoleMatchedContextPois(runtimePois, dir);

  const channels = roleMatched.filter(
    (poi): poi is Extract<RouterRawPoi, { kind: "CHANNEL" }> =>
      poi.kind === "CHANNEL"
  );

  if (channels.length > 0) {
    return selectBestContextCandidate(
      channels
        .map((poi) =>
          buildChannelSelectionCandidate(poi, zone, atrAtEval, openTime)
        )
        .filter((candidate): candidate is ObContextSelection => Boolean(candidate))
    );
  }

  const trendlines = roleMatched.filter(
    (poi): poi is Extract<RouterRawPoi, { kind: "TRENDLINE" }> =>
      poi.kind === "TRENDLINE"
  );

  return selectBestContextCandidate(
    trendlines
      .map((poi) =>
        buildTrendlineSelectionCandidate(poi, zone, atrAtEval, openTime)
      )
      .filter((candidate): candidate is ObContextSelection => Boolean(candidate))
  );
}

export function evaluateObContextDistanceAgainstRuntimePois(
  args: EvaluateObContextAtTimeArgs
): ObContextDistanceEvalResult | null {
  const { atrAtEval } = args;

  if (!Number.isFinite(atrAtEval) || atrAtEval <= 0) {
    return null;
  }

  const selection = evaluateObContextSelectionAtTime(args);

  if (!selection) {
    return evaluateObContextDistanceFilter({
      atrAtTrigger: atrAtEval,
    });
  }

  return selection.source === "CHANNEL"
    ? evaluateObContextDistanceFilter({
        atrAtTrigger: atrAtEval,
        channelDistance: selection.distanceRaw,
      })
    : evaluateObContextDistanceFilter({
        atrAtTrigger: atrAtEval,
        trendlineDistance: selection.distanceRaw,
      });
}

export function evaluateObContextCollabAgainstRuntimePois(
  args: EvaluateObContextAtTimeArgs
): {
  tags: string[];
  bestCollab?: ObCollabBestMatch;
} {
  const selection = evaluateObContextSelectionAtTime(args);

  if (!selection) {
    return { tags: [] };
  }

  return {
    tags: [selection.tag],
    bestCollab: {
      kind: "OB∩CONTEXT",
      targetId: selection.targetId,
      ratioOrDist: selection.distanceAtr,
      tag: selection.tag,
    },
  };
}

export function mergeObCollabState(args: {
  baseTags?: readonly string[];
  fvgTags?: readonly string[];
  fvgBestCollab?: ObCollabBestMatch;
  contextTags?: readonly string[];
  contextBestCollab?: ObCollabBestMatch;
}): {
  tags: string[];
  bestCollab?: ObCollabBestMatch;
} {
  const {
    baseTags = [],
    fvgTags = [],
    fvgBestCollab,
    contextTags = [],
    contextBestCollab,
  } = args;

  return {
    tags: uniqueLexicographicTags([
      ...baseTags,
      ...fvgTags,
      ...contextTags,
    ]),
    bestCollab: fvgBestCollab ?? contextBestCollab,
  };
}

export function shouldEvaluateObContextForBox(box: AnyObBox): boolean {
  if (box.type === "D1_POI_OB") {
    return box.state === "ACTIVE";
  }

  if (box.type === "H4_CORE_OB") {
    return box.state === "POI_ACTIVE";
  }

  return box.state === "ACTIVE";
}

