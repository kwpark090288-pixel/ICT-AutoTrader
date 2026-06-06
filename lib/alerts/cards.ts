import type {
  AlertTrafficLightState,
  SelectedFeedCard,
  SelectedFeedCloseCard,
  SelectedFeedOpenCard,
  StoredSignalEventWithSeen,
} from "./types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getAlertTrafficLightState(
  event: StoredSignalEventWithSeen
): AlertTrafficLightState {
  if (event.policyState === "HALT") {
    return "SKIP";
  }

  if (event.entryQuality === "LATE" && event.collabStrength === "NONE") {
    return "SKIP";
  }

  if (
    event.entryQuality === "IDEAL" &&
    event.collabStrength === "STRONG" &&
    event.policyState === "NORMAL"
  ) {
    return "STRONG";
  }

  if (event.policyState === "CAUTION") {
    return "CAUTION";
  }

  return "CAUTION";
}

export function pickCloseWeaknessPreview(
  event: StoredSignalEventWithSeen
): string[] {
  return (event.weaknessCodes ?? []).slice(0, 2);
}

export function hasReviewNoteBadge(
  _event: StoredSignalEventWithSeen,
  reviewNoteText?: string | null
): boolean {
  return isNonEmptyString(reviewNoteText);
}

export function resolveOpenLinkPlanId(
  event: StoredSignalEventWithSeen
): string | null {
  if (event.type !== "SEND_CLOSE") {
    return null;
  }

  return isNonEmptyString(event.planId) ? event.planId : null;
}

export function buildSelectedFeedOpenCard(
  event: StoredSignalEventWithSeen
): SelectedFeedOpenCard | null {
  if (
    event.type !== "SEND_OPEN" ||
    !isFiniteNumber(event.entryRefPrice) ||
    !isFiniteNumber(event.stopPrice) ||
    !isFiniteNumber(event.tpPrice) ||
    !isFiniteNumber(event.rrChosen)
  ) {
    return null;
  }

  const card: SelectedFeedOpenCard = {
    kind: "OPEN",
    id: event.id,
    symbol: event.symbol,
    tf: event.tf,
    time: event.time,
    direction: event.direction,
    entryRefPrice: event.entryRefPrice,
    stopPrice: event.stopPrice,
    tpPrice: event.tpPrice,
    rrChosen: event.rrChosen,
    policyState: event.policyState,
    trafficLight: getAlertTrafficLightState(event),
  };

  if (event.tpMode !== undefined) {
    card.tpMode = event.tpMode;
  }

  if (event.entryQuality !== undefined) {
    card.entryQuality = event.entryQuality;
  }

  if (event.poiTier !== undefined) {
    card.poiTier = event.poiTier;
  }

  if (event.collabStrength !== undefined) {
    card.collabStrength = event.collabStrength;
  }

  if (event.score !== undefined) {
    card.score = event.score;
  }

  if (event.severity !== undefined) {
    card.severity = event.severity;
  }

  return card;
}

export function buildSelectedFeedCloseCard(
  event: StoredSignalEventWithSeen,
  reviewNoteText?: string | null
): SelectedFeedCloseCard | null {
  if (
    event.type !== "SEND_CLOSE" ||
    !isNonEmptyString(event.outcome) ||
    !isFiniteNumber(event.exitPrice) ||
    !isFiniteNumber(event.rGross)
  ) {
    return null;
  }

  const weaknessPreview = pickCloseWeaknessPreview(event);
  const totalWeaknessCount = event.weaknessCodes?.length ?? 0;

  const card: SelectedFeedCloseCard = {
    kind: "CLOSE",
    id: event.id,
    symbol: event.symbol,
    tf: event.tf,
    time: event.exitTime ?? event.time,
    direction: event.direction,
    outcome: event.outcome,
    exitPrice: event.exitPrice,
    rGross: event.rGross,
    weaknessPreview,
    weaknessMoreCount: Math.max(0, totalWeaknessCount - weaknessPreview.length),
    hasReviewNoteBadge: hasReviewNoteBadge(event, reviewNoteText),
  };

  if (event.mfeR !== undefined) {
    card.mfeR = event.mfeR;
  }

  if (event.maeR !== undefined) {
    card.maeR = event.maeR;
  }

  if (event.bothHit !== undefined) {
    card.bothHit = event.bothHit;
  }

  if (event.replayNote !== undefined) {
    card.replayNote = event.replayNote;
  }

  const openLinkPlanId = resolveOpenLinkPlanId(event);
  if (openLinkPlanId !== null) {
    card.openLinkPlanId = openLinkPlanId;
  }

  if (event.score !== undefined) {
    card.score = event.score;
  }

  if (event.severity !== undefined) {
    card.severity = event.severity;
  }

  return card;
}

export function buildSelectedFeedCard(
  event: StoredSignalEventWithSeen,
  reviewNoteText?: string | null
): SelectedFeedCard | null {
  if (event.type === "SEND_OPEN") {
    return buildSelectedFeedOpenCard(event);
  }

  if (event.type === "SEND_CLOSE") {
    return buildSelectedFeedCloseCard(event, reviewNoteText);
  }

  return null;
}
