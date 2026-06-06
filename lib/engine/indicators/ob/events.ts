import { formatTags } from "../../tags";
import { resolveObFvgCollabEvent } from "./collab-event";
import {
  formatObTickNormalizedPrice,
  formatObZoneForOutput,
  normalizeObZoneToTick,
} from "./normalize";
import type {
  AnyObBox,
  D1PoiOb,
  H4CoreOb,
  SetupOb,
  Zone,
} from "./types";

function formatIsoUtc(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function formatZone(zone: Zone, tick: number): string {
  if (!(Number.isFinite(tick) && tick > 0)) {
    return `${zone.bottom}~${zone.top}`;
  }

  const normalized = normalizeObZoneToTick({
    bottom: zone.bottom,
    top: zone.top,
    tick,
  });

  if (!normalized) {
    return `${formatObTickNormalizedPrice(zone.bottom, tick)}~${formatObTickNormalizedPrice(zone.top, tick)}`;
  }

  return formatObZoneForOutput(normalized, tick);
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function formatTouchTf(tf: SetupOb["tf"] | H4CoreOb["tf"] | D1PoiOb["tf"]): string {
  return tf;
}

export function formatD1PoiObCandidateNewEvent(
  time: number,
  box: D1PoiOb,
  tick: number
): string {
  return `[NEW][D1][POI_OB][CANDIDATE] time=${formatIsoUtc(time)} zone=${formatZone(box.zone, tick)}`;
}

export function formatD1PoiObConfirmEvent(
  time: number,
  box: D1PoiOb,
  tick: number
): string {
  return `[CONFIRM][D1][POI_OB] time=${formatIsoUtc(time)} tags=${formatTags(box.tags)} zone=${formatZone(box.zone, tick)}`;
}

export function formatH4CoreObCandidateNewEvent(
  time: number,
  box: H4CoreOb,
  tick: number
): string {
  return `[NEW][4H][OB][CANDIDATE] time=${formatIsoUtc(time)} zone=${formatZone(box.zone, tick)}`;
}

export function formatH4CoreObConfirmEvent(
  time: number,
  box: H4CoreOb,
  tick: number
): string {
  return `[CONFIRM][4H][OB][POI] time=${formatIsoUtc(time)} tags=${formatTags(box.tags)} zone=${formatZone(box.zone, tick)}`;
}

export function formatSetupObNewEvent(
  time: number,
  box: SetupOb,
  tick: number
): string {
  return `[NEW][${box.tf}][SETUP_OB] time=${formatIsoUtc(time)} inside=${box.parentPoiType === "D1_POI_OB" ? "D1" : "4H"}:${box.parentPoiId} tags=${formatTags(box.tags)} zone=${formatZone(box.zone, tick)}`;
}

export function formatObTouchEvent(
  tf: string,
  id: string,
  time: number,
  touchCount: number
): string {
  return `[TOUCH][${tf}][${id}] time=${formatIsoUtc(time)} touchCount=${touchCount}`;
}

export function formatObInvalidEvent(
  tf: string,
  id: string,
  time: number,
  reason: string,
  endTime: number
): string {
  return `[INVALID][${tf}][${id}] time=${formatIsoUtc(time)} reason=${reason} endTime=${formatIsoUtc(endTime)}`;
}

export function buildObLifecycleEvents(args: {
  prevD1Pois: readonly D1PoiOb[];
  nextD1Pois: readonly D1PoiOb[];
  prevH4CoreObs: readonly H4CoreOb[];
  nextH4CoreObs: readonly H4CoreOb[];
  prevSetupObs: readonly SetupOb[];
  nextSetupObs: readonly SetupOb[];
  currentCloseTime: number;
  tickSize: number | null;
}): string[] {
  const {
    prevD1Pois,
    nextD1Pois,
    prevH4CoreObs,
    nextH4CoreObs,
    prevSetupObs,
    nextSetupObs,
    currentCloseTime,
    tickSize,
  } = args;
  const tick =
    Number.isFinite(tickSize) && (tickSize as number) > 0
      ? (tickSize as number)
      : 0;
  const events: string[] = [];
  const prevD1 = new Map(prevD1Pois.map((box) => [box.id, box]));
  const prevH4 = new Map(prevH4CoreObs.map((box) => [box.id, box]));
  const prevSetup = new Map(prevSetupObs.map((box) => [box.id, box]));

  for (const box of sortById(nextD1Pois)) {
    const prev = prevD1.get(box.id);

    if (!prev && box.state === "CANDIDATE") {
      events.push(formatD1PoiObCandidateNewEvent(currentCloseTime, box, tick));
      continue;
    }

    if (prev?.state === "CANDIDATE" && box.state === "ACTIVE") {
      events.push(formatD1PoiObConfirmEvent(currentCloseTime, box, tick));
    }

    if (
      prev?.touchCount !== undefined &&
      box.touchCount > prev.touchCount &&
      Number.isFinite(box.lastTouchTime)
    ) {
      events.push(
        formatObTouchEvent(
          formatTouchTf(box.tf),
          box.id,
          box.lastTouchTime as number,
          box.touchCount
        )
      );
    }

    if (
      prev &&
      prev.state !== box.state &&
      box.invalidReason &&
      Number.isFinite(box.endTime)
    ) {
      events.push(
        formatObInvalidEvent(
          "D1",
          box.id,
          box.endTime as number,
          box.invalidReason,
          box.endTime as number
        )
      );
    }

    const collabEvent = resolveObFvgCollabEvent(
      currentCloseTime,
      box,
      prev?.bestCollab,
      box.bestCollab
    );
    if (collabEvent) {
      events.push(collabEvent);
    }
  }

  for (const box of sortById(nextH4CoreObs)) {
    const prev = prevH4.get(box.id);

    if (!prev && box.state === "CANDIDATE") {
      events.push(formatH4CoreObCandidateNewEvent(currentCloseTime, box, tick));
      continue;
    }

    if (prev?.state === "CANDIDATE" && box.state === "POI_ACTIVE") {
      events.push(formatH4CoreObConfirmEvent(currentCloseTime, box, tick));
    }

    if (
      prev?.touchCount !== undefined &&
      box.touchCount > prev.touchCount &&
      Number.isFinite(box.lastTouchTime)
    ) {
      events.push(
        formatObTouchEvent(
          formatTouchTf(box.tf),
          box.id,
          box.lastTouchTime as number,
          box.touchCount
        )
      );
    }

    if (
      prev &&
      prev.state !== box.state &&
      box.invalidReason &&
      Number.isFinite(box.endTime)
    ) {
      events.push(
        formatObInvalidEvent(
          "H4",
          box.id,
          box.endTime as number,
          box.invalidReason,
          box.endTime as number
        )
      );
    }

    const collabEvent = resolveObFvgCollabEvent(
      currentCloseTime,
      box,
      prev?.bestCollab,
      box.bestCollab
    );
    if (collabEvent) {
      events.push(collabEvent);
    }
  }

  for (const box of sortById(nextSetupObs)) {
    const prev = prevSetup.get(box.id);

    if (!prev && box.state === "ACTIVE") {
      events.push(formatSetupObNewEvent(currentCloseTime, box, tick));
    }

    if (
      prev?.touchCount !== undefined &&
      box.touchCount > prev.touchCount &&
      Number.isFinite(box.lastTouchTime)
    ) {
      events.push(
        formatObTouchEvent(
          formatTouchTf(box.tf),
          box.id,
          box.lastTouchTime as number,
          box.touchCount
        )
      );
    }

    if (
      prev &&
      prev.state !== box.state &&
      box.invalidReason &&
      Number.isFinite(box.endTime)
    ) {
      events.push(
        formatObInvalidEvent(
          box.tf,
          box.id,
          box.endTime as number,
          box.invalidReason,
          box.endTime as number
        )
      );
    }

    const collabEvent = resolveObFvgCollabEvent(
      currentCloseTime,
      box,
      prev?.bestCollab,
      box.bestCollab
    );
    if (collabEvent) {
      events.push(collabEvent);
    }
  }

  return events;
}
