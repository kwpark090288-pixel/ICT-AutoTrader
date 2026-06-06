import { compareLexicographic, uniqueLexicographicTags } from "../../tags";
import {
  CONTEXT_OK_ATR_D1,
  CONTEXT_OK_ATR_H1,
  CONTEXT_OK_ATR_H4,
  CONTEXT_OK_ATR_M30,
  CONTEXT_TIGHT_ATR_D1,
  CONTEXT_TIGHT_ATR_H1,
  CONTEXT_TIGHT_ATR_H4,
  CONTEXT_TIGHT_ATR_M30,
  TL_COLLAB_CHANNEL_TIGHT,
  TL_COLLAB_POI_OK,
  TL_COLLAB_POI_TIGHT,
} from "./constants";
import { getTrendlineLinePriceAt } from "./lifecycle";
import type {
  BestMatch,
  Trendline,
  TrendlineCollabEvalResult,
  TrendlineModelTf,
  Zone,
} from "./types";
import type {
  D1PoiOb,
  H4CoreOb,
  SetupOb,
} from "../ob/types";
import type {
  D1PoiFvg,
  H4CoreFvg,
  SetupFvg,
  StackZone,
} from "../fvg/types";
import type { ChannelModel } from "../channel/types";
import { linePriceAt } from "../channel/basic";
import type { RouterRawPoi } from "../../../router/raw-event";

const DIST_EPSILON_FACTOR = 1e-6;

export type TrendlineObSource = D1PoiOb | H4CoreOb | SetupOb;
export type TrendlineFvgSource =
  | D1PoiFvg
  | H4CoreFvg
  | SetupFvg
  | StackZone;

type TrendlineCollabCandidate = {
  kind: "OB" | "FVG" | "CHANNEL";
  id: string;
  distancePrice: number;
  distanceTicks: number;
  distanceAtr: number;
  refTime: number;
  tag: string;
};

type EvaluateTrendlineCollabArgs = {
  line: Trendline;
  currentCloseTime: number;
  atrAtBar: number;
  tick: number;
  obs: readonly TrendlineObSource[];
  fvgs: readonly TrendlineFvgSource[];
  channels: readonly ChannelModel[];
};

function getTrendlineIntentDir(
  line: Trendline
): "BULL" | "BEAR" {
  return line.type === "TL_SUPPORT" ? "BULL" : "BEAR";
}

function getTrendlineTfThresholds(
  tf: TrendlineModelTf
): { ok: number; tight: number } {
  if (tf === "D1") {
    return { ok: CONTEXT_OK_ATR_D1, tight: CONTEXT_TIGHT_ATR_D1 };
  }

  if (tf === "H4") {
    return { ok: CONTEXT_OK_ATR_H4, tight: CONTEXT_TIGHT_ATR_H4 };
  }

  if (tf === "H1") {
    return { ok: CONTEXT_OK_ATR_H1, tight: CONTEXT_TIGHT_ATR_H1 };
  }

  return { ok: CONTEXT_OK_ATR_M30, tight: CONTEXT_TIGHT_ATR_M30 };
}

export function isEligibleObForTrendlineCollab(
  line: Trendline,
  ob: TrendlineObSource
): boolean {
  const sameSymbol =
    line.symbol.toUpperCase() === ob.symbol.toUpperCase();

  if (!sameSymbol) {
    return false;
  }

  if (ob.dir !== getTrendlineIntentDir(line)) {
    return false;
  }

  if (line.tf === "D1") {
    return ob.type === "D1_POI_OB" && ob.state === "ACTIVE";
  }

  if (line.tf === "H4") {
    return ob.type === "H4_CORE_OB" && ob.state === "POI_ACTIVE";
  }

  if (line.tf === "H1") {
    return ob.type === "SETUP_OB" && ob.state === "ACTIVE" && ob.tf === "H1";
  }

  return ob.type === "SETUP_OB" && ob.state === "ACTIVE" && ob.tf === "M30";
}

export function isEligibleFvgForTrendlineCollab(
  line: Trendline,
  fvg: TrendlineFvgSource
): boolean {
  const sameSymbol =
    line.symbol.toUpperCase() === fvg.symbol.toUpperCase();

  if (!sameSymbol) {
    return false;
  }

  if (fvg.type === "STACK_ZONE") {
    return false;
  }

  if (fvg.dir !== getTrendlineIntentDir(line)) {
    return false;
  }

  if (line.tf === "D1") {
    return fvg.type === "D1_POI_FVG" && fvg.state === "ACTIVE";
  }

  if (line.tf === "H4") {
    return fvg.type === "H4_CORE_FVG" && fvg.state === "A_ACTIVE";
  }

  if (line.tf === "H1") {
    return fvg.type === "SETUP_FVG" && fvg.state === "ACTIVE" && fvg.tf === "H1";
  }

  return fvg.type === "SETUP_FVG" && fvg.state === "ACTIVE" && fvg.tf === "M30";
}

export function isEligibleChannelForTrendlineCollab(
  line: Trendline,
  channel: ChannelModel
): boolean {
  return (
    line.symbol.toUpperCase() === channel.symbol.toUpperCase() &&
    line.tf === channel.tf &&
    channel.state === "ACTIVE" &&
    (channel.mode === "ENABLED" || channel.mode === "CONTEXT_ONLY")
  );
}

export function computeTrendlineDistanceToZone(
  linePriceNow: number,
  zone: Zone
): number {
  if (linePriceNow >= zone.bottom && linePriceNow <= zone.top) {
    return 0;
  }

  return Math.min(
    Math.abs(linePriceNow - zone.bottom),
    Math.abs(linePriceNow - zone.top)
  );
}

export function computeTrendlineDistanceTicks(
  distanceToZone: number,
  tick: number
): number {
  const eps = tick * DIST_EPSILON_FACTOR;
  return Math.ceil(Math.max(distanceToZone - eps, 0) / tick);
}

export function getTrendlinePoiCollabTag(
  tf: TrendlineModelTf,
  distanceAtr: number
): string | null {
  const { ok, tight } = getTrendlineTfThresholds(tf);

  if (distanceAtr <= tight) {
    return TL_COLLAB_POI_TIGHT;
  }

  if (distanceAtr <= ok) {
    return TL_COLLAB_POI_OK;
  }

  return null;
}

export function getTrendlineChannelCollabTag(
  tf: TrendlineModelTf,
  distanceAtr: number
): string | null {
  const { tight } = getTrendlineTfThresholds(tf);

  if (distanceAtr <= tight) {
    return TL_COLLAB_CHANNEL_TIGHT;
  }

  return null;
}

export function stripTrendlineCollabTags(tags: readonly string[]): string[] {
  return tags.filter(
    (tag) =>
      tag !== TL_COLLAB_POI_OK &&
      tag !== TL_COLLAB_POI_TIGHT &&
      tag !== TL_COLLAB_CHANNEL_TIGHT
  );
}

export function applyTrendlineCollabSnapshot(
  line: Trendline,
  collab: TrendlineCollabEvalResult
): Trendline {
  const baseTags = stripTrendlineCollabTags(line.tags);

  return {
    ...line,
    tags: uniqueLexicographicTags([...baseTags, ...collab.tags]),
    bestMatch: collab.bestMatch,
  };
}

function parseIsoUtcSecond(value?: string): number {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function getChannelLowerUpperAt(
  channel: ChannelModel,
  time: number
): { lower: number; upper: number } | null {
  if (!channel.geometry) {
    return null;
  }

  const anchor = linePriceAt(channel.geometry.anchorLine, time);

  if (channel.geometry.dir === "UP") {
    return {
      lower: anchor,
      upper: anchor + channel.geometry.offset,
    };
  }

  return {
    lower: anchor - channel.geometry.offset,
    upper: anchor,
  };
}

export function computeTrendlineChannelBoundaryDistance(
  line: Trendline,
  channel: ChannelModel,
  currentCloseTime: number
): number | null {
  const linePriceNow = getTrendlineLinePriceAt(line, currentCloseTime);
  const bounds = getChannelLowerUpperAt(channel, currentCloseTime);

  if (!bounds) {
    return null;
  }

  return line.type === "TL_SUPPORT"
    ? Math.abs(linePriceNow - bounds.lower)
    : Math.abs(linePriceNow - bounds.upper);
}

function selectBestTrendlineCollabCandidate(
  candidates: readonly TrendlineCollabCandidate[]
): TrendlineCollabCandidate | null {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((a, b) => {
    if (a.distanceTicks !== b.distanceTicks) {
      return a.distanceTicks - b.distanceTicks;
    }

    if (a.refTime !== b.refTime) {
      return b.refTime - a.refTime;
    }

    return compareLexicographic(a.id, b.id);
  })[0];
}

function buildBestMatch(candidate: TrendlineCollabCandidate): BestMatch {
  return {
    kind: candidate.kind,
    id: candidate.id,
    distAtr: candidate.distanceAtr,
    meta: candidate.tag,
  };
}

export function evaluateTrendlineCollab(
  args: EvaluateTrendlineCollabArgs
): TrendlineCollabEvalResult {
  const { line, currentCloseTime, atrAtBar, tick, obs, fvgs, channels } = args;

  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) {
    return { tags: [], bestMatch: { kind: "NONE" } };
  }

  if (!Number.isFinite(tick) || tick <= 0) {
    return { tags: [], bestMatch: { kind: "NONE" } };
  }

  const linePriceNow = getTrendlineLinePriceAt(line, currentCloseTime);

  const tags: string[] = [];
  const candidates: TrendlineCollabCandidate[] = [];

  for (const ob of obs) {
    if (!isEligibleObForTrendlineCollab(line, ob)) {
      continue;
    }

    const distancePrice = computeTrendlineDistanceToZone(linePriceNow, ob.zone);
    const distanceAtr = distancePrice / atrAtBar;
    const tag = getTrendlinePoiCollabTag(line.tf, distanceAtr);

    if (!tag) {
      continue;
    }

    tags.push(tag);
    candidates.push({
      kind: "OB",
      id: ob.id,
      distancePrice,
      distanceTicks: computeTrendlineDistanceTicks(distancePrice, tick),
      distanceAtr,
      refTime: ob.createdAt,
      tag,
    });
  }

  for (const fvg of fvgs) {
    if (!isEligibleFvgForTrendlineCollab(line, fvg)) {
      continue;
    }

    const distancePrice = computeTrendlineDistanceToZone(linePriceNow, fvg.zone);
    const distanceAtr = distancePrice / atrAtBar;
    const tag = getTrendlinePoiCollabTag(line.tf, distanceAtr);

    if (!tag) {
      continue;
    }

    tags.push(tag);
    candidates.push({
      kind: "FVG",
      id: fvg.id,
      distancePrice,
      distanceTicks: computeTrendlineDistanceTicks(distancePrice, tick),
      distanceAtr,
      refTime: fvg.confTime,
      tag,
    });
  }

  for (const channel of channels) {
    if (!isEligibleChannelForTrendlineCollab(line, channel)) {
      continue;
    }

    const distancePrice = computeTrendlineChannelBoundaryDistance(
      line,
      channel,
      currentCloseTime
    );

    if (!Number.isFinite(distancePrice)) {
      continue;
    }

    const distanceAtr = (distancePrice as number) / atrAtBar;
    const tag = getTrendlineChannelCollabTag(line.tf, distanceAtr);

    if (!tag) {
      continue;
    }

    tags.push(tag);
    candidates.push({
      kind: "CHANNEL",
      id: channel.id,
      distancePrice: distancePrice as number,
      distanceTicks: computeTrendlineDistanceTicks(distancePrice as number, tick),
      distanceAtr,
      refTime: channel.lastUpdatedAt,
      tag,
    });
  }

  const best = selectBestTrendlineCollabCandidate(candidates);

  if (!best) {
    return {
      tags: [],
      bestMatch: { kind: "NONE" },
    };
  }

  return {
    tags: uniqueLexicographicTags(tags),
    bestMatch: buildBestMatch(best),
  };
}

export function evaluateTrendlineCollabFromRuntimePois(args: {
  line: Trendline;
  currentCloseTime: number;
  atrAtBar: number;
  tick: number;
  pois: readonly RouterRawPoi[];
}): TrendlineCollabEvalResult {
  const { line, currentCloseTime, atrAtBar, tick, pois } = args;

  if (!Number.isFinite(atrAtBar) || atrAtBar <= 0) {
    return { tags: [], bestMatch: { kind: "NONE" } };
  }

  if (!Number.isFinite(tick) || tick <= 0) {
    return { tags: [], bestMatch: { kind: "NONE" } };
  }

  const linePriceNow = getTrendlineLinePriceAt(line, currentCloseTime);
  const intentDir = getTrendlineIntentDir(line);
  const openTime = toIsoUtcSecond(currentCloseTime);
  const tags: string[] = [];
  const candidates: TrendlineCollabCandidate[] = [];

  for (const poi of pois) {
    if (poi.kind === "OB" || poi.kind === "FVG") {
      if (poi.dir !== intentDir) {
        continue;
      }

      if (line.tf === "D1") {
        if (
          !(
            (poi.kind === "OB" && poi.type === "D1_POI_OB" && poi.state === "ACTIVE") ||
            (poi.kind === "FVG" && poi.type === "D1_POI_FVG" && poi.state === "ACTIVE")
          )
        ) {
          continue;
        }
      } else if (line.tf === "H4") {
        if (
          !(
            (poi.kind === "OB" && poi.type === "H4_CORE_OB" && poi.state === "POI_ACTIVE") ||
            (poi.kind === "FVG" && poi.type === "H4_CORE_FVG" && poi.state === "A_ACTIVE")
          )
        ) {
          continue;
        }
      } else if (line.tf === "H1") {
        if (
          !(
            (poi.kind === "OB" && poi.type === "SETUP_OB" && poi.state === "ACTIVE" && poi.tf === "H1") ||
            (poi.kind === "FVG" && poi.type === "SETUP_FVG" && poi.state === "ACTIVE" && poi.tf === "H1")
          )
        ) {
          continue;
        }
      } else if (line.tf === "M30") {
        if (
          !(
            (poi.kind === "OB" && poi.type === "SETUP_OB" && poi.state === "ACTIVE" && poi.tf === "M30") ||
            (poi.kind === "FVG" && poi.type === "SETUP_FVG" && poi.state === "ACTIVE" && poi.tf === "M30")
          )
        ) {
          continue;
        }
      } else {
        continue;
      }

      const distancePrice = computeTrendlineDistanceToZone(linePriceNow, {
        bottom: poi.zone.bottom,
        top: poi.zone.top,
        height: poi.zone.top - poi.zone.bottom,
      });
      const distanceAtr = distancePrice / atrAtBar;
      const tag = getTrendlinePoiCollabTag(line.tf, distanceAtr);

      if (!tag) {
        continue;
      }

      tags.push(tag);
      candidates.push({
        kind: poi.kind,
        id: poi.id,
        distancePrice,
        distanceTicks: computeTrendlineDistanceTicks(distancePrice, tick),
        distanceAtr,
        refTime: parseIsoUtcSecond(poi.confTime),
        tag,
      });
      continue;
    }

    if (poi.kind === "CHANNEL") {
      if (poi.tf !== line.tf) {
        continue;
      }

      if (!(poi.state === "ENABLED" || poi.state === "CONTEXT_ONLY")) {
        continue;
      }

      const boundaryPrice =
        line.type === "TL_SUPPORT"
          ? poi.lowerBandAt(openTime)
          : poi.upperBandAt(openTime);

      if (!Number.isFinite(boundaryPrice)) {
        continue;
      }

      const distancePrice = Math.abs(linePriceNow - boundaryPrice);
      const distanceAtr = distancePrice / atrAtBar;
      const tag = getTrendlineChannelCollabTag(line.tf, distanceAtr);

      if (!tag) {
        continue;
      }

      tags.push(tag);
      candidates.push({
        kind: "CHANNEL",
        id: poi.id,
        distancePrice,
        distanceTicks: computeTrendlineDistanceTicks(distancePrice, tick),
        distanceAtr,
        refTime: Number.isFinite(poi.updatedAtMs)
          ? (poi.updatedAtMs as number)
          : parseIsoUtcSecond(poi.confTime),
        tag,
      });
    }
  }

  const best = selectBestTrendlineCollabCandidate(candidates);

  if (!best) {
    return { tags: [], bestMatch: { kind: "NONE" } };
  }

  return {
    tags: uniqueLexicographicTags(tags),
    bestMatch: buildBestMatch(best),
  };
}
