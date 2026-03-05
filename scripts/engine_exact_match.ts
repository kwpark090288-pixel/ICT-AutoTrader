import assert from "node:assert/strict";
import { createCompositeEngine } from "../lib/engine/composite-engine";
import { formatTags, uniqueLexicographicTags } from "../lib/engine/tags";
import {
  countPruneOverflow,
  getPrunedIdsByOldest,
} from "../lib/engine/pruning";
import {
  appendBarForTf,
  createTfBarStore,
  getBarCountForTf,
  getBarsForTf,
  setBarsForTf,
} from "../lib/engine/bar-store";
import * as FvgConstants from "../lib/engine/indicators/fvg/constants";
import {
  detectConfirmedWickFvgFromRecentBars,
  detectConfirmedWickFvgWithAtrFromTfBars,
  isFvgDetectTf,
} from "../lib/engine/indicators/fvg/engine";
import {
  buildAtr14Snapshots,
  getAtrSnapshotAtConfTime,
  getAtrValueAtConfTime,
} from "../lib/engine/indicators/fvg/atr";
import {
  detectConfirmedFractalPivotAtIndex,
  detectNewlyConfirmedFractalPivot,
  isPivotStructureTf,
} from "../lib/engine/indicators/fvg/pivots";
import { evaluateStructureAtClose } from "../lib/engine/indicators/fvg/structure";
import {
  evaluateDisplacementF1FromRecentBars,
  evaluateDisplacementF1FromTfBars,
  getCandleBodySize,
} from "../lib/engine/indicators/fvg/displacement";
import {
  evaluateSweepRecoveryFromTfBars,
  resolveSweepRecoveryTarget,
} from "../lib/engine/indicators/fvg/sweep-recovery";
import { evaluateF4Context } from "../lib/engine/indicators/fvg/context";
import {
  evaluateD1MixedStrongDisplacementFromRecentBars,
  evaluateD1PoiFvgInvalidationFlags,
  evaluateD1PoiFvgRegistration,
} from "../lib/engine/indicators/fvg/d1-poi";
import {
  createH4CoreFvgCandidate,
  getH4CoreConfirmDueTime,
  getH4CoreDisplayUntil,
} from "../lib/engine/indicators/fvg/h4-core";
import {
  applyH4CoreFvgCandidateConfirm,
  countH4SecondaryPasses,
  evaluateH4CoreFvgCandidateConfirm,
} from "../lib/engine/indicators/fvg/h4-confirm";
import {
  resolveFvgInvalidationDecision,
  resolveFvgInvalidationReasonWithPriority,
} from "../lib/engine/indicators/fvg/invalidation";
import {
  computeTouchOverlapLen,
  computeTouchPenetrationMin,
  evaluateTouchPenetrationFilter,
} from "../lib/engine/indicators/fvg/touch-filter";
import type { Bar } from "../lib/engine/types";

function assertExactEventLog(
  actual: string[],
  expected: string[],
  label: string
) {
  assert.equal(
    actual.length,
    expected.length,
    `${label}: event count mismatch (expected=${expected.length}, actual=${actual.length})`
  );

  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(
      actual[i],
      expected[i],
      `${label}: mismatch at index=${i}\nexpected=${JSON.stringify(
        expected[i]
      )}\nactual=${JSON.stringify(actual[i])}`
    );
  }
}

function collectEventLog(bars: Bar[]): string[] {
  const engine = createCompositeEngine();
  const out: string[] = [];

  for (const bar of bars) {
    out.push(...engine.onBarClose(bar));
  }

  return out;
}

const bars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 1, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 1, 23, 59, 59),
    open: 100,
    high: 105,
    low: 99,
    close: 104,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 3, 59, 59),
    open: 104,
    high: 106,
    low: 103,
    close: 105,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 4, 59, 59),
    open: 105,
    high: 107,
    low: 104,
    close: 106,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 5, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 29, 59),
    open: 106,
    high: 106.5,
    low: 105.5,
    close: 106.2,
  },
  {
    tf: "M15",
    openTime: Date.UTC(2026, 2, 2, 5, 30, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 44, 59),
    open: 106.2,
    high: 106.4,
    low: 105.9,
    close: 106.1,
  },
  {
    tf: "M5",
    openTime: Date.UTC(2026, 2, 2, 5, 45, 0),
    closeTime: Date.UTC(2026, 2, 2, 5, 49, 59),
    open: 106.1,
    high: 106.3,
    low: 106.0,
    close: 106.25,
  },
];

const harnessExpected = ["[TEST][HARNESS] alpha", "[TEST][HARNESS] beta"];
const harnessActual = ["[TEST][HARNESS] alpha", "[TEST][HARNESS] beta"];
const tagInput = ["ZETA", "ALPHA", "BETA", "ALPHA"];
const tagExpected = ["ALPHA", "BETA", "ZETA"];
const pruneInput = [
  { id: "D", confTime: 3000 },
  { id: "C", confTime: 1000 },
  { id: "B", confTime: 1000 },
  { id: "A", confTime: 2000 },
];

const pruneExpected = ["B", "C"];

const storeM5Bar1: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 0, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 4, 59),
  open: 10,
  high: 11,
  low: 9,
  close: 10.5,
};

const storeM5Bar2: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 5, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 9, 59),
  open: 10.5,
  high: 11.5,
  low: 10.25,
  close: 11,
};

const storeM5Bar3: Bar = {
  tf: "M5",
  openTime: Date.UTC(2026, 2, 2, 6, 10, 0),
  closeTime: Date.UTC(2026, 2, 2, 6, 14, 59),
  open: 11,
  high: 12,
  low: 10.8,
  close: 11.75,
};

const bullFvgBars: Bar[] = [
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 7, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 7, 59, 59),
    open: 96,
    high: 100,
    low: 95,
    close: 97,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 8, 59, 59),
    open: 97,
    high: 99,
    low: 96,
    close: 98,
  },
  {
    tf: "H1",
    openTime: Date.UTC(2026, 2, 2, 9, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 9, 59, 59),
    open: 103,
    high: 106,
    low: 102,
    close: 105,
  },
];

const bearFvgBars: Bar[] = [
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 10, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 10, 29, 59),
    open: 111,
    high: 112,
    low: 110,
    close: 111,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 10, 30, 0),
    closeTime: Date.UTC(2026, 2, 2, 10, 59, 59),
    open: 110,
    high: 111,
    low: 109,
    close: 109.5,
  },
  {
    tf: "M30",
    openTime: Date.UTC(2026, 2, 2, 11, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 11, 29, 59),
    open: 107,
    high: 108,
    low: 104,
    close: 105,
  },
];

const smallFvgBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 12, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 15, 59, 59),
    open: 96,
    high: 100,
    low: 95,
    close: 98,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 16, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 19, 59, 59),
    open: 98,
    high: 100.5,
    low: 97.5,
    close: 99,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 2, 20, 0, 0),
    closeTime: Date.UTC(2026, 2, 2, 23, 59, 59),
    open: 101,
    high: 103,
    low: 101,
    close: 102,
  },
];

const atrH1Bars: Bar[] = Array.from({ length: 15 }, (_, i) => {
  const openTime = Date.UTC(2026, 2, 3, i, 0, 0);
  const closeTime = Date.UTC(2026, 2, 3, i, 59, 59);

  if (i <= 11) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
    };
  }

  if (i === 12) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 100,
    };
  }

  if (i === 13) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 100,
      high: 110,
      low: 100,
      close: 105,
    };
  }

  return {
    tf: "H1" as const,
    openTime,
    closeTime,
    open: 105,
    high: 112,
    low: 102,
    close: 107,
  };
});

const pivotHighD1Bars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 4, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 4, 23, 59, 59),
    open: 10,
    high: 11,
    low: 8,
    close: 9,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 5, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 5, 23, 59, 59),
    open: 11,
    high: 12,
    low: 8.5,
    close: 10,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 6, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 6, 23, 59, 59),
    open: 12,
    high: 13,
    low: 9,
    close: 11,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 7, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 7, 23, 59, 59),
    open: 13,
    high: 20,
    low: 10,
    close: 14,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 8, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 8, 23, 59, 59),
    open: 12,
    high: 14,
    low: 9.5,
    close: 11,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 9, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 9, 23, 59, 59),
    open: 11,
    high: 13,
    low: 9,
    close: 10,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 10, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 10, 23, 59, 59),
    open: 10,
    high: 12,
    low: 8.5,
    close: 9,
  },
];

const pivotLowH4Bars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 3, 59, 59),
    open: 20,
    high: 22,
    low: 10,
    close: 19,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 7, 59, 59),
    open: 19,
    high: 21,
    low: 9,
    close: 18,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 11, 59, 59),
    open: 18,
    high: 20,
    low: 8,
    close: 17,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 12, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 15, 59, 59),
    open: 17,
    high: 19,
    low: 2,
    close: 16,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 16, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 19, 59, 59),
    open: 18,
    high: 20,
    low: 7,
    close: 18,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 11, 20, 0, 0),
    closeTime: Date.UTC(2026, 2, 11, 23, 59, 59),
    open: 19,
    high: 21,
    low: 8,
    close: 19,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 12, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 12, 3, 59, 59),
    open: 20,
    high: 22,
    low: 9,
    close: 20,
  },
];

const pivotHighH1Bars: Bar[] = pivotHighD1Bars.map((bar) => ({
  ...bar,
  tf: "H1" as const,
}));

const pivotLowD1Bars: Bar[] = pivotLowH4Bars.map((bar) => ({
  ...bar,
  tf: "D1" as const,
}));

const displacementMaxPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 3, 59, 59),
    open: 10,
    high: 15,
    low: 9,
    close: 14,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 7, 59, 59),
    open: 15,
    high: 27,
    low: 14,
    close: 26,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 13, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 13, 11, 59, 59),
    open: 26,
    high: 29,
    low: 25,
    close: 28,
  },
];

const displacementSumPassBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 3, 59, 59),
    open: 10,
    high: 17,
    low: 9,
    close: 16,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 7, 59, 59),
    open: 16,
    high: 17,
    low: 9,
    close: 10,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 14, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 14, 11, 59, 59),
    open: 10,
    high: 18,
    low: 9,
    close: 17,
  },
];

const displacementStrictFailBars: Bar[] = [
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 3, 59, 59),
    open: 10,
    high: 21,
    low: 9,
    close: 20,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 4, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 7, 59, 59),
    open: 20,
    high: 25,
    low: 19,
    close: 24,
  },
  {
    tf: "H4",
    openTime: Date.UTC(2026, 2, 15, 8, 0, 0),
    closeTime: Date.UTC(2026, 2, 15, 11, 59, 59),
    open: 24,
    high: 25,
    low: 19,
    close: 20,
  },
];

const atrDisplacementH1Bars: Bar[] = Array.from({ length: 15 }, (_, i) => {
  const openTime = Date.UTC(2026, 2, 16, i, 0, 0);
  const closeTime = Date.UTC(2026, 2, 16, i, 59, 59);

  if (i <= 11) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
    };
  }

  if (i === 12) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 94,
      high: 100,
      low: 90,
      close: 100,
    };
  }

  if (i === 13) {
    return {
      tf: "H1" as const,
      openTime,
      closeTime,
      open: 100,
      high: 104,
      low: 94,
      close: 94,
    };
  }

  return {
    tf: "H1" as const,
    openTime,
    closeTime,
    open: 93,
    high: 103,
    low: 93,
    close: 100,
  };
});

function buildH4SweepBars(
  overrides: Record<number, Partial<Bar>>,
  count = 18
): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const openTime = Date.UTC(2026, 2, 18, i * 4, 0, 0);
    const closeTime = Date.UTC(2026, 2, 18, i * 4 + 3, 59, 59);

    const base: Bar = {
      tf: "H4",
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
    };

    return {
      ...base,
      ...(overrides[i] ?? {}),
    };
  });
}

const sweepBullEqLowPair = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 90.5,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 90,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepBullWideLowPair = [
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 90,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "LOW" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 91.2,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepBearEqHighPair = [
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    pivotPrice: 109.5,
    confirmedAt: Date.UTC(2026, 2, 17, 15, 59, 59),
    isConfirmed: true,
  },
  {
    tf: "H4" as const,
    pivotType: "HIGH" as const,
    pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
    pivotPrice: 110,
    confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
    isConfirmed: true,
  },
] as const;

const sweepFallbackLowPivot = {
  tf: "H4" as const,
  pivotType: "LOW" as const,
  pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
  pivotPrice: 88,
  confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
  isConfirmed: true,
};

const sweepFallbackHighPivot = {
  tf: "H4" as const,
  pivotType: "HIGH" as const,
  pivotTime: Date.UTC(2026, 2, 18, 3, 59, 59),
  pivotPrice: 112,
  confirmedAt: Date.UTC(2026, 2, 18, 15, 59, 59),
  isConfirmed: true,
};

const sweepBullBarsValid = buildH4SweepBars({
  16: { open: 94, high: 95, low: 89, close: 89 },
  17: { open: 89, high: 92, low: 88, close: 91 },
});

const sweepBullBarsLateSweep = buildH4SweepBars(
  {
    17: { open: 89, high: 92, low: 89, close: 89 },
    18: { open: 89, high: 92, low: 88, close: 91 },
  },
  19
);

const sweepBullBarsLateRecovery = buildH4SweepBars(
  {
    16: { open: 94, high: 95, low: 89, close: 89 },
    17: { open: 89, high: 90, low: 88, close: 90 },
    18: { open: 90, high: 92, low: 89, close: 91 },
  },
  19
);

const sweepBearBarsValid = buildH4SweepBars({
  16: { open: 109, high: 111, low: 105, close: 106 },
  17: { open: 106, high: 109, low: 104, close: 109 },
});

const f4ContextInput = {
  symbol: "BTCUSDT",
  tf: "H4" as const,
  dir: "BULL" as const,
  confTime: Date.UTC(2026, 2, 19, 3, 59, 59),
};

const d1StrongDispMaxBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 20, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 20, 23, 59, 59),
    open: 100,
    high: 106,
    low: 99,
    close: 104,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 21, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 21, 23, 59, 59),
    open: 104,
    high: 121,
    low: 103,
    close: 120,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 22, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 22, 23, 59, 59),
    open: 120,
    high: 124,
    low: 119,
    close: 123,
  },
];

const d1StrongDispSumBars: Bar[] = [
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 23, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 23, 23, 59, 59),
    open: 100,
    high: 109,
    low: 99,
    close: 108,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 24, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 24, 23, 59, 59),
    open: 108,
    high: 117,
    low: 107,
    close: 116,
  },
  {
    tf: "D1",
    openTime: Date.UTC(2026, 2, 25, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 25, 23, 59, 59),
    open: 116,
    high: 126,
    low: 115,
    close: 125,
  },
];

const d1BullDetectedFvg = {
  tf: "D1" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 102,
    height: 2,
  },
};

const d1BearDetectedFvg = {
  tf: "D1" as const,
  dir: "BEAR" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 98,
    top: 100,
    height: 2,
  },
};

const d1SmallDetectedFvg = {
  tf: "D1" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 26, 23, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 27, 23, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  confTime: Date.UTC(2026, 2, 28, 23, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 101,
    height: 1,
  },
};

const H4_BAR_DURATION_MS = 4 * 60 * 60 * 1000;

const h4DetectedFvg = {
  tf: "H4" as const,
  dir: "BULL" as const,
  leftCloseTime: Date.UTC(2026, 2, 29, 3, 59, 59),
  middleCloseTime: Date.UTC(2026, 2, 29, 7, 59, 59),
  rightCloseTime: Date.UTC(2026, 2, 29, 11, 59, 59),
  confTime: Date.UTC(2026, 2, 29, 11, 59, 59),
  atrAtConf: 10,
  zone: {
    bottom: 100,
    top: 102,
    height: 2,
  },
};

const h4DisplacementPassEval = {
  confTime: h4DetectedFvg.confTime,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const h4DisplacementMismatchedEval = {
  confTime: h4DetectedFvg.confTime - H4_BAR_DURATION_MS,
  atrAtConf: 10,
  bodyMax: 11,
  bodySum: 17,
  passByMax: true,
  passBySum: false,
  passDisplacement: true,
};

const h4CandidatePassF1 = createH4CoreFvgCandidate({
  id: "H4-C-1",
  symbol: "BTCUSDT",
  detectedFvg: h4DetectedFvg,
  displacementEval: h4DisplacementPassEval,
})!;

const h4CandidateFailF1 = createH4CoreFvgCandidate({
  id: "H4-C-2",
  symbol: "BTCUSDT",
  detectedFvg: h4DetectedFvg,
  displacementEval: h4DisplacementMismatchedEval,
})!;

assertExactEventLog(harnessActual, harnessExpected, "harness self-check");

assertExactEventLog(
  uniqueLexicographicTags(tagInput),
  tagExpected,
  "tag unique+sort"
);

assert.equal(
  formatTags(tagInput),
  "ALPHA|BETA|ZETA",
  "tag format"
);

assert.equal(
  countPruneOverflow(4, 2),
  2,
  "prune overflow count"
);

assertExactEventLog(
  getPrunedIdsByOldest(pruneInput, 2),
  pruneExpected,
  "prune oldest ids"
);

assertExactEventLog(
  getPrunedIdsByOldest(pruneInput, 4),
  [],
  "prune none when within limit"
);

const tfStore = createTfBarStore();

appendBarForTf(tfStore, storeM5Bar1, 2);
appendBarForTf(tfStore, storeM5Bar2, 2);
appendBarForTf(tfStore, storeM5Bar3, 2);

assert.equal(
  getBarCountForTf(tfStore, "M5"),
  2,
  "bar store append keeps lookback size"
);

assert.deepEqual(
  getBarsForTf(tfStore, "M5").map((bar) => bar.closeTime),
  [storeM5Bar2.closeTime, storeM5Bar3.closeTime],
  "bar store append keeps newest bars"
);

setBarsForTf(tfStore, "D1", [bars[0], bars[0]], 1);

assert.equal(
  getBarCountForTf(tfStore, "D1"),
  1,
  "bar store set trims to lookback"
);

assert.equal(
  getBarCountForTf(tfStore, "H4"),
  0,
  "bar store keeps tf separated"
);

assertExactEventLog(
  [...FvgConstants.FVG_TFS],
  ["D1", "H4", "H1", "M30", "M15", "M5"],
  "fvg tf set"
);

assertExactEventLog(
  [...FvgConstants.FVG_BOX_TYPES],
  ["D1_POI_FVG", "H4_CORE_FVG", "SETUP_FVG", "STACK_ZONE"],
  "fvg box types"
);

assert.deepEqual(
  {
    activeInactive: [...FvgConstants.FVG_ACTIVE_INACTIVE_STATES],
    h4: [...FvgConstants.FVG_H4_CORE_STATES],
    stack: [...FvgConstants.FVG_STACK_STATES],
  },
  {
    activeInactive: ["ACTIVE", "INACTIVE"],
    h4: ["CANDIDATE", "A_ACTIVE", "INACTIVE", "DELETED"],
    stack: ["ACTIVE", "INACTIVE"],
  },
  "fvg states"
);

assertExactEventLog(
  [...FvgConstants.FVG_INVALID_REASONS],
  [
    "full_fill",
    "opposite_choch",
    "touch_3",
    "pruned_by_limit",
    "failed_confirm",
  ],
  "fvg invalid reasons"
);

assert.deepEqual(
  [...FvgConstants.FVG_TRIGGER_TOKENS],
  [
    "SWEEP_REC",
    "CHOCH",
    "MR_FVG_BOUNDARY",
    "MR_MICRO_OB",
    "MR_MICRO_FVG",
  ],
  "fvg trigger tokens"
);

assert.deepEqual(
  {
    MAX_FORWARD_BARS: FvgConstants.MAX_FORWARD_BARS,
    MIN_ZONE_HEIGHT_ATR: FvgConstants.MIN_ZONE_HEIGHT_ATR,
    PENETRATION_ATR: FvgConstants.PENETRATION_ATR,
    PENETRATION_ZONE: FvgConstants.PENETRATION_ZONE,
    INSIDE_OVERLAP_RATIO: FvgConstants.INSIDE_OVERLAP_RATIO,
    STACK_OVERLAP_RATIO: FvgConstants.STACK_OVERLAP_RATIO,
    LTF_GATE_ATR: FvgConstants.LTF_GATE_ATR,
    FVG_PIVOT_LEN: FvgConstants.FVG_PIVOT_LEN,
    DISPLACEMENT_BODY_MAX_ATR: FvgConstants.DISPLACEMENT_BODY_MAX_ATR,
    DISPLACEMENT_BODY_SUM_ATR: FvgConstants.DISPLACEMENT_BODY_SUM_ATR,
    D1_MIXED_STRONG_DISP_BODY_MAX_ATR:
      FvgConstants.D1_MIXED_STRONG_DISP_BODY_MAX_ATR,
    D1_MIXED_STRONG_DISP_BODY_SUM_ATR:
      FvgConstants.D1_MIXED_STRONG_DISP_BODY_SUM_ATR,
    H4_CONFIRM_DELAY_BARS: FvgConstants.H4_CONFIRM_DELAY_BARS,
    COOLDOWN_AFTER_15M_REACTION_MIN:
      FvgConstants.COOLDOWN_AFTER_15M_REACTION_MIN,
    COOLDOWN_AFTER_5M_ENTRY_MIN: FvgConstants.COOLDOWN_AFTER_5M_ENTRY_MIN,
    MAX_ACTIVE_D1: FvgConstants.MAX_ACTIVE_D1,
    MAX_ACTIVE_H4_POOL: FvgConstants.MAX_ACTIVE_H4_POOL,
    MAX_ACTIVE_H1_SETUP: FvgConstants.MAX_ACTIVE_H1_SETUP,
    MAX_ACTIVE_M30_SETUP: FvgConstants.MAX_ACTIVE_M30_SETUP,
  },
  {
    MAX_FORWARD_BARS: 300,
    MIN_ZONE_HEIGHT_ATR: 0.15,
    PENETRATION_ATR: 0.1,
    PENETRATION_ZONE: 0.25,
    INSIDE_OVERLAP_RATIO: 0.2,
    STACK_OVERLAP_RATIO: 0.3,
    LTF_GATE_ATR: 0.2,
    FVG_PIVOT_LEN: 3,
    DISPLACEMENT_BODY_MAX_ATR: 1.0,
    DISPLACEMENT_BODY_SUM_ATR: 1.8,
    D1_MIXED_STRONG_DISP_BODY_MAX_ATR: 1.5,
    D1_MIXED_STRONG_DISP_BODY_SUM_ATR: 2.4,
    H4_CONFIRM_DELAY_BARS: 3,
    COOLDOWN_AFTER_15M_REACTION_MIN: 30,
    COOLDOWN_AFTER_5M_ENTRY_MIN: 60,
    MAX_ACTIVE_D1: 3,
    MAX_ACTIVE_H4_POOL: 10,
    MAX_ACTIVE_H1_SETUP: 6,
    MAX_ACTIVE_M30_SETUP: 6,
  },
  "fvg numeric constants"
);

assert.equal(
  isFvgDetectTf("D1"),
  true,
  "fvg detect tf includes D1"
);

assert.equal(
  isFvgDetectTf("M15"),
  false,
  "fvg detect tf excludes M15"
);

assert.deepEqual(
  detectConfirmedWickFvgFromRecentBars(bullFvgBars, 10),
  {
    tf: "H1",
    dir: "BULL",
    leftCloseTime: bullFvgBars[0].closeTime,
    middleCloseTime: bullFvgBars[1].closeTime,
    rightCloseTime: bullFvgBars[2].closeTime,
    confTime: bullFvgBars[2].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
  },
  "fvg bull wick triplet detect"
);

assert.deepEqual(
  detectConfirmedWickFvgFromRecentBars(bearFvgBars, 10),
  {
    tf: "M30",
    dir: "BEAR",
    leftCloseTime: bearFvgBars[0].closeTime,
    middleCloseTime: bearFvgBars[1].closeTime,
    rightCloseTime: bearFvgBars[2].closeTime,
    confTime: bearFvgBars[2].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 108,
      top: 110,
      height: 2,
    },
  },
  "fvg bear wick triplet detect"
);

assert.equal(
  detectConfirmedWickFvgFromRecentBars(smallFvgBars, 10),
  null,
  "fvg reject too small zone"
);

assert.equal(
  detectConfirmedWickFvgFromRecentBars(bullFvgBars.slice(0, 2), 10),
  null,
  "fvg needs 3 confirmed bars"
);

const atrSnapshots = buildAtr14Snapshots(atrH1Bars);

assert.equal(
  atrSnapshots.length,
  2,
  "fvg atr snapshots count"
);

assert.deepEqual(
  getAtrSnapshotAtConfTime(atrH1Bars, atrH1Bars[14].closeTime),
  {
    tf: "H1",
    time: atrH1Bars[14].closeTime,
    atr14: 10,
  },
  "fvg atr snapshot at conf time"
);

assert.equal(
  getAtrValueAtConfTime(atrH1Bars.slice(0, 13), atrH1Bars[12].closeTime),
  null,
  "fvg atr requires 14 bars"
);

assert.equal(
  getAtrValueAtConfTime(atrH1Bars, atrH1Bars[14].closeTime),
  10,
  "fvg atr sampled from conf close"
);

assert.deepEqual(
  detectConfirmedWickFvgWithAtrFromTfBars(atrH1Bars),
  {
    tf: "H1",
    dir: "BULL",
    leftCloseTime: atrH1Bars[12].closeTime,
    middleCloseTime: atrH1Bars[13].closeTime,
    rightCloseTime: atrH1Bars[14].closeTime,
    confTime: atrH1Bars[14].closeTime,
    atrAtConf: 10,
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
  },
  "fvg detect uses atr at conf time"
);

assert.equal(
  isPivotStructureTf("D1"),
  true,
  "fvg pivot tf includes D1"
);

assert.equal(
  isPivotStructureTf("H1"),
  false,
  "fvg pivot tf excludes H1"
);

assert.deepEqual(
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars, "HIGH", 3),
  {
    tf: "D1",
    pivotType: "HIGH",
    pivotTime: pivotHighD1Bars[3].closeTime,
    pivotPrice: 20,
    confirmedAt: pivotHighD1Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot high confirmed at p+3 close"
);

assert.deepEqual(
  detectConfirmedFractalPivotAtIndex(pivotLowH4Bars, "LOW", 3),
  {
    tf: "H4",
    pivotType: "LOW",
    pivotTime: pivotLowH4Bars[3].closeTime,
    pivotPrice: 2,
    confirmedAt: pivotLowH4Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot low confirmed at p+3 close"
);

assert.equal(
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars.slice(0, 6), "HIGH", 3),
  null,
  "fvg pivot rejects unconfirmed before p+3 close"
);

assert.equal(
  detectConfirmedFractalPivotAtIndex(pivotHighH1Bars, "HIGH", 3),
  null,
  "fvg pivot forbidden outside D1 H4"
);

assert.deepEqual(
  detectNewlyConfirmedFractalPivot(pivotHighD1Bars, "HIGH"),
  {
    tf: "D1",
    pivotType: "HIGH",
    pivotTime: pivotHighD1Bars[3].closeTime,
    pivotPrice: 20,
    confirmedAt: pivotHighD1Bars[6].closeTime,
    isConfirmed: true,
  },
  "fvg pivot latest newly confirmed"
);

const structurePivotHighD1 =
  detectConfirmedFractalPivotAtIndex(pivotHighD1Bars, "HIGH", 3)!;

const structurePivotLowD1 =
  detectConfirmedFractalPivotAtIndex(pivotLowD1Bars, "LOW", 3)!;

assertExactEventLog(
  [...FvgConstants.FVG_STRUCTURE_BREAK_TYPES],
  ["BOS", "CHOCH"],
  "fvg structure break types"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 15,
    lastConfirmedPivotHigh: structurePivotHighD1,
  }),
  {
    structureReady: false,
    prevState: "UP",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure not ready missing low pivot"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 5,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: false,
    prevState: "DOWN",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure not ready missing high pivot"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "UP",
    breakType: "BOS",
  },
  "fvg structure mixed to up via bos"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "DOWN",
    breakType: "BOS",
  },
  "fvg structure mixed to down via bos"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "MIXED",
    close: 10,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "MIXED",
    nextState: "MIXED",
    breakType: null,
  },
  "fvg structure mixed no break stays mixed"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "UP",
    breakType: "BOS",
  },
  "fvg structure up bos keeps up"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "DOWN",
    breakType: "CHOCH",
  },
  "fvg structure up choch to down"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "UP",
    close: 20,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "UP",
    nextState: "UP",
    breakType: null,
  },
  "fvg structure equality at pivot high is not break"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 1,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "DOWN",
    breakType: "BOS",
  },
  "fvg structure down bos keeps down"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 21,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "UP",
    breakType: "CHOCH",
  },
  "fvg structure down choch to up"
);

assert.deepEqual(
  evaluateStructureAtClose({
    prevState: "DOWN",
    close: 2,
    lastConfirmedPivotHigh: structurePivotHighD1,
    lastConfirmedPivotLow: structurePivotLowD1,
  }),
  {
    structureReady: true,
    prevState: "DOWN",
    nextState: "DOWN",
    breakType: null,
  },
  "fvg structure equality at pivot low is not break"
);

assert.equal(
  getCandleBodySize({
    tf: "H4",
    openTime: Date.UTC(2026, 2, 17, 0, 0, 0),
    closeTime: Date.UTC(2026, 2, 17, 3, 59, 59),
    open: 120,
    high: 121,
    low: 109,
    close: 110,
  }),
  10,
  "fvg displacement body is abs close-open"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementMaxPassBars, 10),
  {
    confTime: displacementMaxPassBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 11,
    bodySum: 17,
    passByMax: true,
    passBySum: false,
    passDisplacement: true,
  },
  "fvg displacement passes by max body"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementSumPassBars, 10),
  {
    confTime: displacementSumPassBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 7,
    bodySum: 19,
    passByMax: false,
    passBySum: true,
    passDisplacement: true,
  },
  "fvg displacement passes by body sum"
);

assert.deepEqual(
  evaluateDisplacementF1FromRecentBars(displacementStrictFailBars, 10),
  {
    confTime: displacementStrictFailBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 10,
    bodySum: 18,
    passByMax: false,
    passBySum: false,
    passDisplacement: false,
  },
  "fvg displacement uses strict greater-than thresholds"
);

assert.equal(
  evaluateDisplacementF1FromTfBars(atrDisplacementH1Bars.slice(0, 13)),
  null,
  "fvg displacement wrapper requires atr at conf time"
);

assert.deepEqual(
  evaluateDisplacementF1FromTfBars(atrDisplacementH1Bars),
  {
    confTime: atrDisplacementH1Bars[14].closeTime,
    atrAtConf: 10,
    bodyMax: 7,
    bodySum: 19,
    passByMax: false,
    passBySum: true,
    passDisplacement: true,
  },
  "fvg displacement wrapper uses conf-time atr"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BULL",
    atrAtConf: 10,
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
  },
  "fvg sweep target bull uses eql outer line with priority"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BEAR",
    atrAtConf: 10,
    eqPivotPair: sweepBearEqHighPair,
    lastConfirmedPivotHigh: sweepFallbackHighPivot,
  }),
  {
    targetType: "EQH",
    linePrice: 110,
    usedEqPair: true,
  },
  "fvg sweep target bear uses eqh outer line with priority"
);

assert.deepEqual(
  resolveSweepRecoveryTarget({
    dir: "BULL",
    atrAtConf: 10,
    eqPivotPair: sweepBullWideLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    targetType: "SWING_LOW",
    linePrice: 88,
    usedEqPair: false,
  },
  "fvg sweep target falls back to last confirmed swing low"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBearBarsValid,
    confIndex: 14,
    dir: "BEAR",
  }),
  {
    hasTarget: false,
    targetType: null,
    linePrice: null,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "fvg sweep no target returns false"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    sweepBarTime: sweepBullBarsValid[16].closeTime,
    recoveryBarTime: sweepBullBarsValid[17].closeTime,
    passSweepRecovery: true,
  },
  "fvg sweep bull passes with sweep in conf+2 and recovery in conf+3"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsLateSweep,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    passSweepRecovery: false,
  },
  "fvg sweep rejects sweep occurring at conf+3"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsLateRecovery,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQL",
    linePrice: 90,
    usedEqPair: true,
    passSweepRecovery: false,
  },
  "fvg sweep requires next close only recovery"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBearBarsValid,
    confIndex: 14,
    dir: "BEAR",
    eqPivotPair: sweepBearEqHighPair,
    lastConfirmedPivotHigh: sweepFallbackHighPivot,
  }),
  {
    hasTarget: true,
    targetType: "EQH",
    linePrice: 110,
    usedEqPair: true,
    sweepBarTime: sweepBearBarsValid[16].closeTime,
    recoveryBarTime: sweepBearBarsValid[17].closeTime,
    passSweepRecovery: true,
  },
  "fvg sweep bear passes with eqh target"
);

assert.equal(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid.slice(0, 13),
    confIndex: 12,
    dir: "BULL",
    eqPivotPair: sweepBullEqLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  null,
  "fvg sweep wrapper requires atr at conf time"
);

assert.deepEqual(
  evaluateSweepRecoveryFromTfBars({
    tfBars: sweepBullBarsValid,
    confIndex: 14,
    dir: "BULL",
    eqPivotPair: sweepBullWideLowPair,
    lastConfirmedPivotLow: sweepFallbackLowPivot,
  }),
  {
    hasTarget: true,
    targetType: "SWING_LOW",
    linePrice: 88,
    usedEqPair: false,
    passSweepRecovery: false,
  },
  "fvg sweep eq pair threshold uses conf atr and falls back"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput),
  {
    source: "NONE",
    passF4: false,
  },
  "fvg f4 defaults false without provider"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput, () => true),
  {
    source: "PROVIDER",
    passF4: true,
  },
  "fvg f4 provider true passes"
);

assert.deepEqual(
  evaluateF4Context(f4ContextInput, () => false),
  {
    source: "PROVIDER",
    passF4: false,
  },
  "fvg f4 provider false blocks"
);

const f4ProviderSeenInputs: unknown[] = [];
evaluateF4Context(f4ContextInput, (input) => {
  f4ProviderSeenInputs.push(input);
  return true;
});

assert.deepEqual(
  f4ProviderSeenInputs,
  [f4ContextInput],
  "fvg f4 provider receives exact input"
);

const d1F1Pass = evaluateDisplacementF1FromRecentBars(displacementMaxPassBars, 10)!;
const d1MixedStrongByMax =
  evaluateD1MixedStrongDisplacementFromRecentBars(d1StrongDispMaxBars, 10)!;
const d1MixedStrongBySum =
  evaluateD1MixedStrongDisplacementFromRecentBars(d1StrongDispSumBars, 10)!;

assert.deepEqual(
  d1MixedStrongByMax,
  {
    confTime: d1StrongDispMaxBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 16,
    bodySum: 23,
    passByMax: true,
    passBySum: false,
    passMixedStrongDisp: true,
  },
  "fvg d1 mixed strong displacement passes by max"
);

assert.deepEqual(
  d1MixedStrongBySum,
  {
    confTime: d1StrongDispSumBars[2].closeTime,
    atrAtConf: 10,
    bodyMax: 9,
    bodySum: 25,
    passByMax: false,
    passBySum: true,
    passMixedStrongDisp: true,
  },
  "fvg d1 mixed strong displacement passes by sum"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration passes for up bull"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BearDetectedFvg,
    structureAtConf: "DOWN",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "DOWN",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration passes for down bear"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "MIXED",
    displacementEval: d1F1Pass,
    mixedStrongDisplacementEval: d1MixedStrongByMax,
  }),
  {
    canRegister: true,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "MIXED",
    passStructureRule: true,
    passMixedStrongDisp: true,
  },
  "fvg d1 registration allows mixed only with strong displacement"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BullDetectedFvg,
    structureAtConf: "MIXED",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "MIXED",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration rejects mixed without strong displacement"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1BearDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: true,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration rejects structure direction mismatch"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: null,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: false,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: false,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration requires detected d1 fvg"
);

assert.deepEqual(
  evaluateD1PoiFvgRegistration({
    detectedFvg: d1SmallDetectedFvg,
    structureAtConf: "UP",
    displacementEval: d1F1Pass,
  }),
  {
    canRegister: false,
    passZoneHeight: false,
    passDisplacement: true,
    structureAtConf: "UP",
    passStructureRule: true,
    passMixedStrongDisp: false,
  },
  "fvg d1 registration requires minimum zone height"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    fullFillHit: true,
  }),
  {
    fullFillInvalidated: true,
    oppositeChochInvalidated: false,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 invalidates on full fill"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    structureBreakType: "CHOCH",
    nextStructureState: "DOWN",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 bull invalidates on opposite choch"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BEAR",
    structureBreakType: "CHOCH",
    nextStructureState: "UP",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 bear invalidates on opposite choch"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
    prunedByLimit: true,
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    pruneInvalidated: true,
    touchInvalidated: false,
  },
  "fvg d1 invalidates on prune"
);

assert.deepEqual(
  evaluateD1PoiFvgInvalidationFlags({
    boxDir: "BULL",
  }),
  {
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    pruneInvalidated: false,
    touchInvalidated: false,
  },
  "fvg d1 has no touch-based invalidation"
);

assert.equal(
  getH4CoreConfirmDueTime(h4DetectedFvg.confTime),
  h4DetectedFvg.confTime + 3 * H4_BAR_DURATION_MS,
  "fvg h4 candidate confirm due is conf+3 close"
);

assert.equal(
  getH4CoreDisplayUntil(h4DetectedFvg.confTime),
  h4DetectedFvg.confTime + 300 * H4_BAR_DURATION_MS,
  "fvg h4 candidate display until uses max forward bars"
);

assert.deepEqual(
  createH4CoreFvgCandidate({
    id: "H4-A-1",
    symbol: "btcusdt",
    detectedFvg: h4DetectedFvg,
    displacementEval: h4DisplacementPassEval,
  }),
  {
    id: "H4-A-1",
    symbol: "BTCUSDT",
    type: "H4_CORE_FVG",
    tf: "H4",
    dir: "BULL",
    zone: {
      bottom: 100,
      top: 102,
      height: 2,
    },
    confTime: h4DetectedFvg.confTime,
    createdAt: h4DetectedFvg.confTime,
    state: "CANDIDATE",
    maxForwardBars: 300,
    displayUntil: h4DetectedFvg.confTime + 300 * H4_BAR_DURATION_MS,
    touchCount: 0,
    fullFillHit: false,
    atrAtConf: 10,
    confirmDueTime: h4DetectedFvg.confTime + 3 * H4_BAR_DURATION_MS,
    passF1: true,
    passF2: false,
    passF3: false,
    passF4: false,
  },
  "fvg h4 candidate created at conf with initial flags"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-2",
    symbol: "BTCUSDT",
    detectedFvg: d1BullDetectedFvg,
  }),
  null,
  "fvg h4 candidate only created from h4 detect"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-3",
    symbol: "BTCUSDT",
    detectedFvg: h4DetectedFvg,
    displacementEval: h4DisplacementMismatchedEval,
  })?.passF1,
  false,
  "fvg h4 candidate f1 requires matching conf time"
);

assert.equal(
  createH4CoreFvgCandidate({
    id: "H4-A-4",
    symbol: "BTCUSDT",
    detectedFvg: h4DetectedFvg,
  })?.passF1,
  false,
  "fvg h4 candidate defaults f1 false without eval"
);

assert.equal(
  countH4SecondaryPasses(true, false, true),
  2,
  "fvg h4 confirm counts secondary passes"
);

assert.deepEqual(
  evaluateH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    isDueTime: true,
    passF1: true,
    secondaryPassCount: 2,
    passConfirm: true,
  },
  "fvg h4 confirm passes at due time with f1 and two secondary"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    state: "A_ACTIVE",
    passF2: true,
    passF3: true,
    passF4: false,
  },
  "fvg h4 confirm promotes candidate to a_active"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidateFailF1,
    currentCloseTime: h4CandidateFailF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidateFailF1,
    state: "DELETED",
    passF2: true,
    passF3: true,
    passF4: true,
    invalidReason: "failed_confirm",
    endTime: h4CandidateFailF1.confirmDueTime,
  },
  "fvg h4 confirm deletes candidate when f1 is missing"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: false,
    passF4: false,
  }),
  {
    ...h4CandidatePassF1,
    state: "DELETED",
    passF2: true,
    passF3: false,
    passF4: false,
    invalidReason: "failed_confirm",
    endTime: h4CandidatePassF1.confirmDueTime,
  },
  "fvg h4 confirm deletes candidate when secondary passes are below two"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: h4CandidatePassF1,
    currentCloseTime: h4CandidatePassF1.confirmDueTime - H4_BAR_DURATION_MS,
    passF2: true,
    passF3: true,
    passF4: false,
  }),
  h4CandidatePassF1,
  "fvg h4 confirm does nothing before due time"
);

assert.deepEqual(
  applyH4CoreFvgCandidateConfirm({
    candidate: {
      ...h4CandidatePassF1,
      state: "A_ACTIVE",
    },
    currentCloseTime: h4CandidatePassF1.confirmDueTime,
    passF2: true,
    passF3: true,
    passF4: true,
  }),
  {
    ...h4CandidatePassF1,
    state: "A_ACTIVE",
  },
  "fvg h4 confirm does not re-evaluate non-candidate state"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: true,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "full_fill",
  "fvg invalidation priority full fill wins"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: true,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "opposite_choch",
  "fvg invalidation priority opposite choch beats touch and prune"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: true,
    pruneInvalidated: true,
  }),
  "touch_3",
  "fvg invalidation priority touch beats prune"
);

assert.equal(
  resolveFvgInvalidationReasonWithPriority({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: true,
  }),
  "pruned_by_limit",
  "fvg invalidation priority prune only"
);

assert.deepEqual(
  resolveFvgInvalidationDecision({
    fullFillInvalidated: false,
    oppositeChochInvalidated: false,
    touchInvalidated: false,
    pruneInvalidated: false,
  }),
  {
    invalidated: false,
    invalidReason: null,
  },
  "fvg invalidation decision none"
);

assert.deepEqual(
  resolveFvgInvalidationDecision(
    evaluateD1PoiFvgInvalidationFlags({
      boxDir: "BULL",
      structureBreakType: "CHOCH",
      nextStructureState: "DOWN",
    })
  ),
  {
    invalidated: true,
    invalidReason: "opposite_choch",
  },
  "fvg invalidation decision accepts d1 flags shape"
);

assert.equal(
  computeTouchOverlapLen({
    wickHigh: 105,
    wickLow: 99,
    top: 103,
    bottom: 100,
  }),
  3,
  "fvg touch overlap uses wick-zone intersection"
);

assert.equal(
  computeTouchPenetrationMin(15, 4),
  1.5,
  "fvg touch penetration min uses atr floor when larger"
);

assert.equal(
  computeTouchPenetrationMin(10, 8),
  2,
  "fvg touch penetration min uses zone floor when larger"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99.5,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1,
    penetrationMin: 1,
    passTouchPenetration: true,
  },
  "fvg touch passes when overlap equals threshold"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 101.5,
    wickLow: 99,
    top: 108,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 1.5,
    penetrationMin: 2,
    passTouchPenetration: false,
  },
  "fvg touch fails below threshold"
);

assert.deepEqual(
  evaluateTouchPenetrationFilter({
    wickHigh: 99,
    wickLow: 95,
    top: 104,
    bottom: 100,
    atrForTf: 10,
  }),
  {
    overlapLen: 0,
    penetrationMin: 1,
    passTouchPenetration: false,
  },
  "fvg touch fails when there is no overlap"
);

assert.equal(
  evaluateTouchPenetrationFilter({
    wickHigh: 101,
    wickLow: 99,
    top: 100,
    bottom: 100,
    atrForTf: 10,
  }),
  null,
  "fvg touch rejects invalid zone"
);

const run1 = collectEventLog(bars);
const run2 = collectEventLog(bars);

assertExactEventLog(run1, run2, "same input same output");
assertExactEventLog(run1, [], "composite stub emits no events yet");

console.log(
  "[ENGINE_EXACT_MATCH_OK]",
  JSON.stringify({
    cases: 108,
    emitted: run1.length,
  })
);
