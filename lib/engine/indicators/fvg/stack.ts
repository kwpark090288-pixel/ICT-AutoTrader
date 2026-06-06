import { compareLexicographic } from "../../tags";
import { MAX_FORWARD_BARS, STACK_OVERLAP_RATIO } from "./constants";
import type {
  D1PoiFvg,
  H4CoreFvg,
  SetupFvg,
  StackZone,
  Zone,
} from "./types";

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;
const H1_BAR_DURATION_MS = 60 * 60 * 1000;
const M30_BAR_DURATION_MS = 30 * 60 * 1000;

export type StackSourceBox = D1PoiFvg | H4CoreFvg | SetupFvg;
export type StackPairType = "D1_H4" | "H4_SETUP";

type NormalizedStackPair =
  | {
      pairType: "D1_H4";
      high: D1PoiFvg;
      low: H4CoreFvg;
    }
  | {
      pairType: "H4_SETUP";
      high: H4CoreFvg;
      low: SetupFvg;
    };

type CreateStackZoneFromPairArgs = {
  id: string;
  symbol: string;
  currentCloseTime: number;
  a: StackSourceBox;
  b: StackSourceBox;
};

type CreateStackZonesInPriorityOrderArgs = {
  symbol: string;
  currentCloseTime: number;
  d1Pois: readonly D1PoiFvg[];
  h4CoreFvgs: readonly H4CoreFvg[];
  setupFvgs: readonly SetupFvg[];
  buildId: (args: {
    pairType: StackPairType;
    high: StackSourceBox;
    low: StackSourceBox;
    currentCloseTime: number;
  }) => string;
};

export function computeStackOverlapLen(aZone: Zone, bZone: Zone): number {
  return Math.max(
    0,
    Math.min(aZone.top, bZone.top) - Math.max(aZone.bottom, bZone.bottom)
  );
}

export function computeStackOverlapRatio(aZone: Zone, bZone: Zone): number {
  const overlapLen = computeStackOverlapLen(aZone, bZone);
  const minHeight = Math.min(aZone.height, bZone.height);

  if (!(minHeight > 0)) {
    return 0;
  }

  return overlapLen / minHeight;
}

export function sortStackSourceBoxesStable<T extends StackSourceBox>(
  boxes: readonly T[]
): T[] {
  return [...boxes].sort((a, b) => {
    if (a.confTime !== b.confTime) {
      return a.confTime - b.confTime;
    }

    return compareLexicographic(a.id, b.id);
  });
}

function isActiveStackSource(box: StackSourceBox): boolean {
  if (box.type === "D1_POI_FVG") {
    return box.state === "ACTIVE";
  }

  if (box.type === "H4_CORE_FVG") {
    return box.state === "A_ACTIVE";
  }

  return box.state === "ACTIVE";
}

function normalizeStackPair(
  a: StackSourceBox,
  b: StackSourceBox
): NormalizedStackPair | null {
  if (a.type === "D1_POI_FVG" && b.type === "H4_CORE_FVG") {
    return {
      pairType: "D1_H4",
      high: a,
      low: b,
    };
  }

  if (a.type === "H4_CORE_FVG" && b.type === "D1_POI_FVG") {
    return {
      pairType: "D1_H4",
      high: b,
      low: a,
    };
  }

  if (a.type === "H4_CORE_FVG" && b.type === "SETUP_FVG") {
    return {
      pairType: "H4_SETUP",
      high: a,
      low: b,
    };
  }

  if (a.type === "SETUP_FVG" && b.type === "H4_CORE_FVG") {
    return {
      pairType: "H4_SETUP",
      high: b,
      low: a,
    };
  }

  return null;
}

export function getStackTfForPair(
  a: StackSourceBox,
  b: StackSourceBox
): "H4" | "H1" | "M30" | null {
  const normalized = normalizeStackPair(a, b);
  if (!normalized) return null;

  if (normalized.pairType === "D1_H4") {
    return "H4";
  }

  if (normalized.low.tf === "H1" || normalized.low.tf === "M30") {
    return normalized.low.tf;
  }

  return null;
}

export function getStackDisplayUntil(
  tf: "H4" | "H1" | "M30",
  confTime: number
): number {
  const durationMs =
    tf === "H4"
      ? H4_BAR_DURATION_MS
      : tf === "H1"
        ? H1_BAR_DURATION_MS
        : M30_BAR_DURATION_MS;

  return confTime + MAX_FORWARD_BARS * durationMs;
}

export function createStackZoneFromPair(
  args: CreateStackZoneFromPairArgs
): StackZone | null {
  const { id, symbol, currentCloseTime, a, b } = args;

  const normalized = normalizeStackPair(a, b);
  if (!normalized) return null;

  if (!isActiveStackSource(normalized.high) || !isActiveStackSource(normalized.low)) {
    return null;
  }

  if (normalized.high.dir !== normalized.low.dir) {
    return null;
  }

  const tf = getStackTfForPair(a, b);
  if (!tf) return null;

  const overlapLen = computeStackOverlapLen(
    normalized.high.zone,
    normalized.low.zone
  );
  const overlapRatio = computeStackOverlapRatio(
    normalized.high.zone,
    normalized.low.zone
  );

  if (overlapRatio < STACK_OVERLAP_RATIO) {
    return null;
  }

  return {
    id,
    symbol: symbol.toUpperCase(),
    type: "STACK_ZONE",
    tf,
    dir: normalized.high.dir,
    zone: {
      bottom: Math.max(normalized.high.zone.bottom, normalized.low.zone.bottom),
      top: Math.min(normalized.high.zone.top, normalized.low.zone.top),
      height: overlapLen,
    },
    confTime: currentCloseTime,
    createdAt: currentCloseTime,
    state: "ACTIVE",
    maxForwardBars: MAX_FORWARD_BARS,
    displayUntil: getStackDisplayUntil(tf, currentCloseTime),
    touchCount: 0,
    fullFillHit: false,
    aId: normalized.high.id,
    bId: normalized.low.id,
    aTf: normalized.high.tf,
    bTf: normalized.low.tf,
    overlapLen,
    overlapRatio,
    passStack: true,
  };
}

export function createStackZonesInPriorityOrder(
  args: CreateStackZonesInPriorityOrderArgs
): StackZone[] {
  const {
    symbol,
    currentCloseTime,
    d1Pois,
    h4CoreFvgs,
    setupFvgs,
    buildId,
  } = args;

  const d1Sorted = sortStackSourceBoxesStable(
    d1Pois.filter((box) => box.state === "ACTIVE")
  );
  const h4Sorted = sortStackSourceBoxesStable(
    h4CoreFvgs.filter((box) => box.state === "A_ACTIVE")
  );
  const setupSorted = sortStackSourceBoxesStable(
    setupFvgs.filter((box) => box.state === "ACTIVE")
  );

  const out: StackZone[] = [];

  for (const d1 of d1Sorted) {
    for (const h4 of h4Sorted) {
      const stack = createStackZoneFromPair({
        id: buildId({
          pairType: "D1_H4",
          high: d1,
          low: h4,
          currentCloseTime,
        }),
        symbol,
        currentCloseTime,
        a: d1,
        b: h4,
      });

      if (stack) {
        out.push(stack);
      }
    }
  }

  for (const h4 of h4Sorted) {
    for (const setup of setupSorted) {
      const stack = createStackZoneFromPair({
        id: buildId({
          pairType: "H4_SETUP",
          high: h4,
          low: setup,
          currentCloseTime,
        }),
        symbol,
        currentCloseTime,
        a: h4,
        b: setup,
      });

      if (stack) {
        out.push(stack);
      }
    }
  }

  return out;
}
