import {
  DAILY_CAP_H1_POI,
  DAILY_CAP_M30_POI,
  TL_COLLAB_CHANNEL_TIGHT,
  TL_COLLAB_POI_OK,
  TL_COLLAB_POI_TIGHT,
} from "./constants";
import type {
  PoiCandidateReason,
  Trendline,
  TrendlinePoiCandidateEventInput,
} from "./types";

type TrendlinePoiTf = "H1" | "M30";

function isTrendlinePoiTf(tf: Trendline["tf"]): tf is TrendlinePoiTf {
  return tf === "H1" || tf === "M30";
}

export function buildTrendlineDailyCapKey(
  symbol: string,
  tf: TrendlinePoiTf,
  closeTime: number
): string {
  return `${symbol.toUpperCase()}:${tf}:${new Date(closeTime).toISOString().slice(0, 10)}`;
}

export function getTrendlineDailyCapLimit(tf: TrendlinePoiTf): number {
  return tf === "H1" ? DAILY_CAP_H1_POI : DAILY_CAP_M30_POI;
}

export function hasTrendlineCollabTag(tags: readonly string[]): boolean {
  return tags.some(
    (tag) =>
      tag === TL_COLLAB_POI_OK ||
      tag === TL_COLLAB_POI_TIGHT ||
      tag === TL_COLLAB_CHANNEL_TIGHT
  );
}

export function getTrendlinePoiCandidateReason(args: {
  roleFlipCount: number;
  hasCollabTag: boolean;
}): PoiCandidateReason | null {
  if (args.roleFlipCount > 0) {
    return "roleFlip";
  }

  if (args.hasCollabTag) {
    return "collab";
  }

  return null;
}

export function buildTrendlinePoiCandidateEventInput(args: {
  line: Trendline;
  currentCloseTime: number;
  currentDailyCapCount: number;
}): TrendlinePoiCandidateEventInput | null {
  const { line, currentCloseTime, currentDailyCapCount } = args;

  if (!isTrendlinePoiTf(line.tf)) {
    return null;
  }

  if (line.state !== "ACTIVE" || line.touchCount < 3) {
    return null;
  }

  const reason = getTrendlinePoiCandidateReason({
    roleFlipCount: line.roleFlipCount,
    hasCollabTag: hasTrendlineCollabTag(line.tags),
  });

  if (!reason) {
    return null;
  }

  if (currentDailyCapCount >= getTrendlineDailyCapLimit(line.tf)) {
    return null;
  }

  return {
    tf: line.tf,
    id: line.id,
    time: currentCloseTime,
    reason,
    touchCount: line.touchCount,
  };
}
