import { uniqueLexicographicTags } from "../../tags";
import type {
  Trendline,
  TrendlinePoiCandidateEventInput,
  TrendlineType,
} from "./types";

function formatIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function formatTrendlineTypeForEvent(
  type: TrendlineType
): "SUPPORT" | "RESIST" {
  return type === "TL_SUPPORT" ? "SUPPORT" : "RESIST";
}

function formatTrendlineTags(tags: readonly string[]): string {
  const unique = uniqueLexicographicTags(tags);
  return unique.length ? unique.join("|") : "-";
}

export function formatTrendlineNewEvent(
  time: number,
  line: Trendline
): string | null {
  if (line.state !== "ACTIVE") {
    return null;
  }

  return `[NEW][${line.tf}][TRENDLINE][${formatTrendlineTypeForEvent(line.type)}] time=${formatIsoUtcSecond(time)} anchors=${line.a1Time}@${line.a1Price};${line.a2Time}@${line.a2Price} tags=${formatTrendlineTags(line.tags)}`;
}

export function shouldEmitTrendlineNewEvent(
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): boolean {
  if (!nextLine || nextLine.state !== "ACTIVE") {
    return false;
  }

  if (!prevLine) {
    return true;
  }

  if (prevLine.state !== "ACTIVE") {
    return true;
  }

  return prevLine.id !== nextLine.id;
}

export function resolveTrendlineNewEvent(
  time: number,
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): string | null {
  if (!shouldEmitTrendlineNewEvent(prevLine, nextLine)) {
    return null;
  }

  return formatTrendlineNewEvent(time, nextLine as Trendline);
}

export function formatTrendlineTouchEvent(
  time: number,
  line: Trendline
): string | null {
  if (line.state !== "ACTIVE" || line.touchCount <= 0) {
    return null;
  }

  return `[TOUCH][${line.tf}][${line.id}] time=${formatIsoUtcSecond(time)} touchCount=${line.touchCount}`;
}

export function shouldEmitTrendlineTouchEvent(
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): boolean {
  if (!prevLine || !nextLine) {
    return false;
  }

  if (nextLine.state !== "ACTIVE") {
    return false;
  }

  return nextLine.touchCount > prevLine.touchCount;
}

export function resolveTrendlineTouchEvent(
  time: number,
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): string | null {
  if (!shouldEmitTrendlineTouchEvent(prevLine, nextLine)) {
    return null;
  }

  return formatTrendlineTouchEvent(time, nextLine as Trendline);
}

export function formatTrendlineRoleFlipEvent(
  time: number,
  line: Trendline
): string | null {
  if (line.state !== "ACTIVE") {
    return null;
  }

  return `[ROLE_FLIP][${line.tf}][${line.id}] time=${formatIsoUtcSecond(time)} newType=${formatTrendlineTypeForEvent(line.type)}`;
}

export function shouldEmitTrendlineRoleFlipEvent(
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): boolean {
  if (!prevLine || !nextLine) {
    return false;
  }

  if (nextLine.state !== "ACTIVE") {
    return false;
  }

  return prevLine.type !== nextLine.type &&
    nextLine.roleFlipCount > prevLine.roleFlipCount;
}

export function resolveTrendlineRoleFlipEvent(
  time: number,
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): string | null {
  if (!shouldEmitTrendlineRoleFlipEvent(prevLine, nextLine)) {
    return null;
  }

  return formatTrendlineRoleFlipEvent(time, nextLine as Trendline);
}

export function formatTrendlineInvalidEvent(
  time: number,
  line: Trendline
): string | null {
  if (line.state !== "INACTIVE" || !line.invalidReason || !line.endTime) {
    return null;
  }

  return `[INVALID][${line.tf}][${line.id}] time=${formatIsoUtcSecond(time)} reason=${line.invalidReason} endTime=${formatIsoUtcSecond(line.endTime)}`;
}

export function shouldEmitTrendlineInvalidEvent(
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): boolean {
  if (!prevLine || !nextLine) {
    return false;
  }

  return prevLine.state === "ACTIVE" && nextLine.state === "INACTIVE";
}

export function resolveTrendlineInvalidEvent(
  time: number,
  prevLine?: Trendline | null,
  nextLine?: Trendline | null
): string | null {
  if (!shouldEmitTrendlineInvalidEvent(prevLine, nextLine)) {
    return null;
  }

  return formatTrendlineInvalidEvent(time, nextLine as Trendline);
}

export function buildTrendlinePoiCandidateEventKey(
  input: TrendlinePoiCandidateEventInput
): string {
  return `${input.tf}:${input.id}:${input.reason}:${input.touchCount}:${input.time}`;
}

export function formatTrendlinePoiCandidateEvent(
  input: TrendlinePoiCandidateEventInput
): string {
  return `[POI_CANDIDATE][${input.tf}][${input.id}] time=${formatIsoUtcSecond(input.time)} reason=${input.reason} touchCount=${input.touchCount}`;
}

export function shouldEmitTrendlinePoiCandidateEvent(
  prevKey?: string | null,
  nextInput?: TrendlinePoiCandidateEventInput | null
): boolean {
  if (!nextInput) {
    return false;
  }

  return buildTrendlinePoiCandidateEventKey(nextInput) !== (prevKey ?? null);
}

export function resolveTrendlinePoiCandidateEvent(
  prevKey?: string | null,
  nextInput?: TrendlinePoiCandidateEventInput | null
): string | null {
  if (!shouldEmitTrendlinePoiCandidateEvent(prevKey, nextInput)) {
    return null;
  }

  return formatTrendlinePoiCandidateEvent(
    nextInput as TrendlinePoiCandidateEventInput
  );
}
