import type { RouterRawPoi } from "../../../router/raw-event";
import type {
  F4ContextEvalResult,
  F4ContextInput,
  F4ProviderKind,
} from "./types";

export type F4ContextProvider = (input: F4ContextInput) => boolean;

type EvaluatedF4Provider = {
  kind: F4ProviderKind;
  id: string;
  distanceAtr: number;
  providerTime: number;
};

function toIsoUtcSecond(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function computeDistanceToZone(
  value: number,
  bottomRaw: number,
  topRaw: number
): number {
  if (value >= bottomRaw && value <= topRaw) {
    return 0;
  }

  return Math.min(
    Math.abs(value - bottomRaw),
    Math.abs(value - topRaw)
  );
}

function isEligibleChannelProvider(
  poi: RouterRawPoi,
  input: F4ContextInput
): poi is Extract<RouterRawPoi, { kind: "CHANNEL" }> {
  if (poi.kind !== "CHANNEL") {
    return false;
  }

  return (
    poi.symbol.toUpperCase() === input.symbol.toUpperCase() &&
    (poi.tf === "H4" || poi.tf === "D1") &&
    poi.state === "ENABLED"
  );
}

function isEligibleTrendlineProvider(
  poi: RouterRawPoi,
  input: F4ContextInput
): poi is Extract<RouterRawPoi, { kind: "TRENDLINE" }> {
  if (poi.kind !== "TRENDLINE") {
    return false;
  }

  return (
    poi.symbol.toUpperCase() === input.symbol.toUpperCase() &&
    (poi.tf === "H4" || poi.tf === "D1") &&
    poi.state === "ACTIVE"
  );
}

function evaluateChannelProvider(
  poi: Extract<RouterRawPoi, { kind: "CHANNEL" }>,
  input: F4ContextInput
): EvaluatedF4Provider | null {
  const providerTime = poi.updatedAtMs;
  if (!(Number.isFinite(providerTime) && providerTime != null)) {
    return null;
  }

  const providerPrice =
    input.dir === "BULL"
      ? poi.lowerBandAt(toIsoUtcSecond(input.confTime))
      : poi.upperBandAt(toIsoUtcSecond(input.confTime));

  if (!Number.isFinite(providerPrice)) {
    return null;
  }

  const distanceRaw = computeDistanceToZone(
    providerPrice,
    input.candidateZone.bottomRaw,
    input.candidateZone.topRaw
  );
  const distanceAtr = distanceRaw / input.atr4hAtConf;

  if (!(Number.isFinite(distanceAtr) && distanceAtr <= 0.25)) {
    return null;
  }

  return {
    kind: "CHANNEL",
    id: poi.id,
    distanceAtr,
    providerTime,
  };
}

function evaluateTrendlineProvider(
  poi: Extract<RouterRawPoi, { kind: "TRENDLINE" }>,
  input: F4ContextInput
): EvaluatedF4Provider | null {
  const providerTime = poi.updatedAtMs;
  if (!(Number.isFinite(providerTime) && providerTime != null)) {
    return null;
  }

  const providerPrice = poi.linePriceAt(toIsoUtcSecond(input.confTime));
  if (!Number.isFinite(providerPrice)) {
    return null;
  }

  const distanceRaw = computeDistanceToZone(
    providerPrice,
    input.candidateZone.bottomRaw,
    input.candidateZone.topRaw
  );
  const distanceAtr = distanceRaw / input.atr4hAtConf;

  if (!(Number.isFinite(distanceAtr) && distanceAtr <= 0.25)) {
    return null;
  }

  return {
    kind: "TRENDLINE",
    id: poi.id,
    distanceAtr,
    providerTime,
  };
}

function selectBestProvider(
  providers: readonly EvaluatedF4Provider[]
): EvaluatedF4Provider | null {
  if (providers.length === 0) {
    return null;
  }

  return [...providers].sort((a, b) => {
    if (a.distanceAtr !== b.distanceAtr) {
      return a.distanceAtr - b.distanceAtr;
    }

    if (a.providerTime !== b.providerTime) {
      return b.providerTime - a.providerTime;
    }

    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

function evaluateSnapshotBackedF4(
  input: F4ContextInput
): F4ContextEvalResult {
  if (
    !Number.isFinite(input.atr4hAtConf) ||
    input.atr4hAtConf <= 0 ||
    !input.getPublishedSnapshot
  ) {
    return {
      source: "NONE",
      passF4: false,
      providerKind: null,
      providerId: null,
      distanceAtr: null,
    };
  }

  const providers: EvaluatedF4Provider[] = [];
  const snapshots = [
    ...input.getPublishedSnapshot("H4", input.confTime),
    ...input.getPublishedSnapshot("D1", input.confTime),
  ];

  for (const poi of snapshots) {
    if (input.dir === "BULL") {
      if (isEligibleChannelProvider(poi, input) && poi.dir === "BULL") {
        const evaluated = evaluateChannelProvider(poi, input);
        if (evaluated) {
          providers.push(evaluated);
        }
      }

      if (isEligibleTrendlineProvider(poi, input) && poi.dir === "BULL") {
        const evaluated = evaluateTrendlineProvider(poi, input);
        if (evaluated) {
          providers.push(evaluated);
        }
      }
      continue;
    }

    if (isEligibleChannelProvider(poi, input) && poi.dir === "BEAR") {
      const evaluated = evaluateChannelProvider(poi, input);
      if (evaluated) {
        providers.push(evaluated);
      }
    }

    if (isEligibleTrendlineProvider(poi, input) && poi.dir === "BEAR") {
      const evaluated = evaluateTrendlineProvider(poi, input);
      if (evaluated) {
        providers.push(evaluated);
      }
    }
  }

  const bestProvider = selectBestProvider(providers);
  if (!bestProvider) {
    return {
      source: "SNAPSHOT",
      passF4: false,
      providerKind: null,
      providerId: null,
      distanceAtr: null,
    };
  }

  return {
    source: "SNAPSHOT",
    passF4: true,
    providerKind: bestProvider.kind,
    providerId: bestProvider.id,
    distanceAtr: bestProvider.distanceAtr,
  };
}

export function evaluateF4Context(
  input: F4ContextInput,
  provider?: F4ContextProvider
): F4ContextEvalResult {
  if (provider) {
    return {
      source: "PROVIDER",
      passF4: Boolean(provider(input)),
      providerKind: null,
      providerId: null,
      distanceAtr: null,
    };
  }

  return evaluateSnapshotBackedF4(input);
}
