import type {
  SoundPlayEvalResult,
  StoredSignalEventWithSeen,
} from "./types";

export function getAlertSeverity(
  event: StoredSignalEventWithSeen
): "HIGH" | "MID" | "LOW" {
  if (
    event.severity === "HIGH" ||
    event.severity === "MID" ||
    event.severity === "LOW"
  ) {
    return event.severity;
  }

  if (
    typeof event.score === "number" &&
    Number.isFinite(event.score) &&
    event.score >= 90
  ) {
    return "HIGH";
  }

  if (event.type === "SEND_OPEN") {
    return "HIGH";
  }

  if (
    typeof event.score === "number" &&
    Number.isFinite(event.score) &&
    event.score >= 80
  ) {
    return "MID";
  }

  if (event.type === "SEND_CLOSE") {
    return "MID";
  }

  return "LOW";
}

type ShouldPlayHighOtherSymbolSoundArgs = {
  profileId?: string;
  selectedSymbol: string;
  event: StoredSignalEventWithSeen;
  mutedKeys?: Set<string>;
  soundEnabled: boolean;
  alreadyPlayed: boolean;
};

export function shouldPlayHighOtherSymbolSound(
  args: ShouldPlayHighOtherSymbolSoundArgs
): SoundPlayEvalResult {
  const {
    selectedSymbol,
    event,
    mutedKeys = new Set<string>(),
    soundEnabled,
    alreadyPlayed,
  } = args;

  if (soundEnabled !== true) {
    return {
      shouldPlay: false,
      reason: "SOUND_OFF",
    };
  }

  if (event.symbol === selectedSymbol) {
    return {
      shouldPlay: false,
      reason: "NOT_OTHER_SYMBOL",
    };
  }

  if (getAlertSeverity(event) !== "HIGH") {
    return {
      shouldPlay: false,
      reason: "NOT_HIGH",
    };
  }

  if (mutedKeys.has(`${event.symbol}|${event.tf}`)) {
    return {
      shouldPlay: false,
      reason: "MUTED",
    };
  }

  if (alreadyPlayed === true) {
    return {
      shouldPlay: false,
      reason: "ALREADY_PLAYED",
    };
  }

  return {
    shouldPlay: true,
    reason: "OK",
  };
}
