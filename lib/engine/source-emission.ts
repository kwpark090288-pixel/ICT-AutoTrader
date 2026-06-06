export type SourceEmissionStage = "NONE" | "REACTION" | "ENTRY_WINDOW_OPEN";

export interface SourceEmissionState {
  stage: SourceEmissionStage;
  weakened: boolean;
  prevBarCloseTime: number | null;
  prevBarTriggers: string[];
}

export interface AdvanceSourceEmissionArgs {
  prev: SourceEmissionState | null | undefined;
  ltf: "M5" | "M15";
  closeTime: number;
  poiId: string;
  gatePass: boolean;
  currentTriggers: readonly string[];
}

export interface AdvanceSourceEmissionResult {
  next: SourceEmissionState;
  currStage: SourceEmissionStage;
  recentTriggers: string[];
  event: string | null;
}

function formatIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

export function normalizeSourceEmissionTriggers(
  triggers: readonly string[]
): string[] {
  return [...new Set(triggers.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

export function computeSourceEmissionStage(
  gatePass: boolean,
  recentTriggers: readonly string[]
): SourceEmissionStage {
  if (!gatePass || recentTriggers.length === 0) {
    return "NONE";
  }

  return recentTriggers.length >= 2 ? "ENTRY_WINDOW_OPEN" : "REACTION";
}

export function formatSourceReactionEvent(args: {
  ltf: "M5" | "M15";
  closeTime: number;
  poiId: string;
  triggers: readonly string[];
}): string {
  const { ltf, closeTime, poiId, triggers } = args;
  return `[REACTION][${ltf}] time=${formatIsoUtcSecond(closeTime)} poi=${poiId} triggers=${normalizeSourceEmissionTriggers(triggers).join("|")}`;
}

export function formatSourceEntryWindowOpenEvent(args: {
  ltf: "M5" | "M15";
  closeTime: number;
  poiId: string;
  triggers: readonly string[];
}): string {
  const { ltf, closeTime, poiId, triggers } = args;
  return `[ENTRY_WINDOW_OPEN][${ltf}] time=${formatIsoUtcSecond(closeTime)} poi=${poiId} triggers=2plus:${normalizeSourceEmissionTriggers(triggers).join("|")}`;
}

export function advanceSourceEmissionState(
  args: AdvanceSourceEmissionArgs
): AdvanceSourceEmissionResult {
  const { prev, ltf, closeTime, poiId, gatePass } = args;
  const currentTriggers = normalizeSourceEmissionTriggers(args.currentTriggers);
  const prevTriggers =
    prev && prev.prevBarCloseTime !== null && prev.prevBarCloseTime < closeTime
      ? prev.prevBarTriggers
      : [];
  const recentTriggers = normalizeSourceEmissionTriggers([
    ...prevTriggers,
    ...currentTriggers,
  ]);
  const currStage = computeSourceEmissionStage(gatePass, recentTriggers);
  const prevStage = prev?.stage ?? "NONE";

  let event: string | null = null;

  if (prevStage === "NONE" && currStage === "REACTION") {
    event = formatSourceReactionEvent({
      ltf,
      closeTime,
      poiId,
      triggers: recentTriggers,
    });
  } else if (
    currStage === "ENTRY_WINDOW_OPEN" &&
    (prevStage === "NONE" || prevStage === "REACTION")
  ) {
    event = formatSourceEntryWindowOpenEvent({
      ltf,
      closeTime,
      poiId,
      triggers: recentTriggers,
    });
  }

  return {
    next: {
      stage: currStage,
      weakened:
        prevStage === "ENTRY_WINDOW_OPEN" && currStage === "REACTION",
      prevBarCloseTime: closeTime,
      prevBarTriggers: currentTriggers,
    },
    currStage,
    recentTriggers,
    event,
  };
}
