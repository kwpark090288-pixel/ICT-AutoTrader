import { formatFvgZoneForOutput, formatTickNormalizedPrice } from "./normalize";
import type {
  D1PoiFvg,
  H4CoreFvg,
  InvalidReason,
  SetupFvg,
  StackZone,
  TickNormalizedZone,
  Zone,
} from "./types";

function formatIsoUtc(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function toTickNormalizedZone(zone: Zone, tick: number): TickNormalizedZone {
  const bottomTick = Math.round(zone.bottom / tick);
  const topTick = Math.round(zone.top / tick);

  return {
    bottomTick,
    topTick,
    bottomNorm: zone.bottom,
    topNorm: zone.top,
  };
}

function formatZone(zone: Zone, tick: number): string {
  if (!(Number.isFinite(tick) && tick > 0)) {
    return `${zone.bottom}~${zone.top}`;
  }

  return formatFvgZoneForOutput(toTickNormalizedZone(zone, tick), tick);
}

function formatSetupTf(tf: SetupFvg["tf"]): "H1" | "30m" {
  return tf === "M30" ? "30m" : "H1";
}

function formatSetupParentLayer(parentPoiType: SetupFvg["parentPoiType"]): "D1" | "4H" {
  return parentPoiType === "D1_POI_FVG" ? "D1" : "4H";
}

function formatStackPair(stack: StackZone): "D1∩4H" | "4H∩1H" | "4H∩30m" {
  if (stack.aTf === "D1" && stack.bTf === "H4") {
    return "D1∩4H";
  }

  if (stack.aTf === "H4" && stack.bTf === "H1") {
    return "4H∩1H";
  }

  return "4H∩30m";
}

function formatConfirmTags(box: H4CoreFvg): string {
  const tags: string[] = [];

  if (box.passF1) tags.push("F1");
  if (box.passF2) tags.push("F2");
  if (box.passF3) tags.push("F3");
  if (box.passF4) tags.push("F4");

  return tags.join("+");
}

export function formatD1PoiFvgNewEvent(box: D1PoiFvg, tick: number): string {
  return `[NEW][D1][POI_FVG][${box.dir}] zone=${formatZone(box.zone, tick)}`;
}

export function formatH4CoreFvgCandidateNewEvent(
  box: H4CoreFvg,
  tick: number
): string {
  return `[NEW][4H][FVG][CANDIDATE] zone=${formatZone(box.zone, tick)}`;
}

export function formatH4CoreFvgConfirmEvent(box: H4CoreFvg, tick: number): string {
  return `[CONFIRM][4H][FVG][A] tags=${formatConfirmTags(box)} zone=${formatZone(box.zone, tick)}`;
}

export function formatSetupFvgNewEvent(box: SetupFvg, tick: number): string {
  return `[NEW][${formatSetupTf(box.tf)}][SETUP_FVG] inside=${formatSetupParentLayer(box.parentPoiType)}:${box.parentPoiId} zone=${formatZone(box.zone, tick)}`;
}

export function formatStackZoneActiveEvent(stack: StackZone, tick: number): string {
  return `[STACK][${formatStackPair(stack)}] zone=${formatZone(stack.zone, tick)}`;
}

export function formatD1PoiFvgInvalidEvent(
  box: D1PoiFvg,
  reason: Extract<InvalidReason, "full_fill" | "opposite_choch" | "pruned_by_limit">,
  endTime: number
): string {
  return `[INVALID][D1][${box.id}] reason=${reason} endTime=${formatIsoUtc(endTime)}`;
}

export function formatH4CoreFvgDeleteEvent(box: H4CoreFvg, tick: number): string {
  return `[DELETE][4H][FVG][CANDIDATE] reason=failed_confirm endTime=${formatIsoUtc(box.endTime ?? box.confTime)} zone=${formatZone(box.zone, tick)}`;
}

export function formatH4CoreFvgInvalidEvent(
  box: H4CoreFvg,
  reason: Extract<InvalidReason, "full_fill" | "opposite_choch" | "touch_3" | "pruned_by_limit">,
  endTime: number
): string {
  return `[INVALID][4H][${box.id}] reason=${reason} endTime=${formatIsoUtc(endTime)}`;
}

export function formatSetupFvgInvalidEvent(
  box: SetupFvg,
  reason: Extract<InvalidReason, "full_fill" | "opposite_choch" | "touch_3" | "pruned_by_limit">,
  endTime: number
): string {
  return `[INVALID][${formatSetupTf(box.tf)}][${box.id}] reason=${reason} endTime=${formatIsoUtc(endTime)}`;
}

export function formatStackZoneEndEvent(
  stack: StackZone,
  reason: "source_inactive" | "overlap_lost" | "pruned_by_limit",
  endTime: number,
  tick: number
): string {
  return `[STACK_END][${formatStackPair(stack)}] reason=${reason} endTime=${formatIsoUtc(endTime)} zone=${formatZone(stack.zone, tick)}`;
}

export function formatFvgOutputPrice(value: number, tick: number): string {
  if (!(Number.isFinite(tick) && tick > 0)) {
    return String(value);
  }

  return formatTickNormalizedPrice(value, tick);
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function buildActiveSourceIdSet(args: {
  d1Pois: readonly D1PoiFvg[];
  h4CoreFvgs: readonly H4CoreFvg[];
  setupFvgs: readonly SetupFvg[];
}): Set<string> {
  const { d1Pois, h4CoreFvgs, setupFvgs } = args;

  return new Set([
    ...d1Pois.filter((box) => box.state === "ACTIVE").map((box) => box.id),
    ...h4CoreFvgs.filter((box) => box.state === "A_ACTIVE").map((box) => box.id),
    ...setupFvgs.filter((box) => box.state === "ACTIVE").map((box) => box.id),
  ]);
}

export function buildFvgLifecycleEvents(args: {
  prevD1Pois: readonly D1PoiFvg[];
  nextD1Pois: readonly D1PoiFvg[];
  prevH4CoreFvgs: readonly H4CoreFvg[];
  nextH4CoreFvgs: readonly H4CoreFvg[];
  prevSetupFvgs: readonly SetupFvg[];
  nextSetupFvgs: readonly SetupFvg[];
  prevStackZones: readonly StackZone[];
  nextStackZones: readonly StackZone[];
  currentCloseTime: number;
  tickSize: number | null;
}): string[] {
  const {
    prevD1Pois,
    nextD1Pois,
    prevH4CoreFvgs,
    nextH4CoreFvgs,
    prevSetupFvgs,
    nextSetupFvgs,
    prevStackZones,
    nextStackZones,
    currentCloseTime,
    tickSize,
  } = args;
  const tick = Number.isFinite(tickSize) && (tickSize as number) > 0 ? (tickSize as number) : 0;
  const events: string[] = [];

  const prevD1 = new Map(prevD1Pois.map((box) => [box.id, box]));
  const nextD1 = new Map(nextD1Pois.map((box) => [box.id, box]));
  const prevH4 = new Map(prevH4CoreFvgs.map((box) => [box.id, box]));
  const prevSetup = new Map(prevSetupFvgs.map((box) => [box.id, box]));
  const prevStack = new Map(prevStackZones.map((box) => [box.id, box]));
  const nextStack = new Map(nextStackZones.map((box) => [box.id, box]));
  const nextActiveSourceIds = buildActiveSourceIdSet({
    d1Pois: nextD1Pois,
    h4CoreFvgs: nextH4CoreFvgs,
    setupFvgs: nextSetupFvgs,
  });

  for (const box of sortById(nextD1Pois)) {
    if (!prevD1.has(box.id) && box.state === "ACTIVE") {
      events.push(formatD1PoiFvgNewEvent(box, tick));
    }
  }

  for (const box of sortById(nextH4CoreFvgs)) {
    const prev = prevH4.get(box.id);
    if (!prev && box.state === "CANDIDATE") {
      events.push(formatH4CoreFvgCandidateNewEvent(box, tick));
      continue;
    }

    if (prev?.state === "CANDIDATE" && box.state === "A_ACTIVE") {
      events.push(formatH4CoreFvgConfirmEvent(box, tick));
      continue;
    }

    if (
      prev?.state === "CANDIDATE" &&
      box.state === "DELETED" &&
      box.invalidReason === "failed_confirm"
    ) {
      events.push(formatH4CoreFvgDeleteEvent(box, tick));
      continue;
    }

    if (
      prev?.state === "A_ACTIVE" &&
      box.state === "INACTIVE" &&
      box.invalidReason &&
      box.invalidReason !== "failed_confirm"
    ) {
      events.push(
        formatH4CoreFvgInvalidEvent(
          box,
          box.invalidReason as "full_fill" | "opposite_choch" | "touch_3" | "pruned_by_limit",
          box.endTime ?? currentCloseTime
        )
      );
    }
  }

  for (const box of sortById(nextSetupFvgs)) {
    const prev = prevSetup.get(box.id);
    if (!prev && box.state === "ACTIVE") {
      events.push(formatSetupFvgNewEvent(box, tick));
      continue;
    }

    if (prev?.state === "ACTIVE" && box.state === "INACTIVE" && box.invalidReason) {
      events.push(
        formatSetupFvgInvalidEvent(
          box,
          box.invalidReason as "full_fill" | "opposite_choch" | "touch_3" | "pruned_by_limit",
          box.endTime ?? currentCloseTime
        )
      );
    }
  }

  for (const box of sortById(nextD1Pois)) {
    const prev = prevD1.get(box.id);
    if (prev?.state === "ACTIVE" && box.state === "INACTIVE" && box.invalidReason) {
      events.push(
        formatD1PoiFvgInvalidEvent(
          box,
          box.invalidReason as "full_fill" | "opposite_choch" | "pruned_by_limit",
          box.endTime ?? currentCloseTime
        )
      );
    }
  }

  for (const box of sortById(nextStackZones)) {
    if (!prevStack.has(box.id)) {
      events.push(formatStackZoneActiveEvent(box, tick));
    }
  }

  for (const box of sortById(prevStackZones)) {
    if (nextStack.has(box.id)) {
      continue;
    }

    const reason =
      nextActiveSourceIds.has(box.aId) && nextActiveSourceIds.has(box.bId)
        ? "overlap_lost"
        : "source_inactive";

    events.push(formatStackZoneEndEvent(box, reason, currentCloseTime, tick));
  }

  return events;
}
