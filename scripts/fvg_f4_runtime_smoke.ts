import assert from "node:assert/strict";
import { createFvgIndicatorEngine } from "../lib/engine/indicators/fvg/engine";
import {
  clearRuntimePoiStore,
  listRuntimePois,
  replaceRuntimeChannelPois,
} from "../lib/engine/runtime-poi-store";
import { setCachedTickSize } from "../lib/engine/ticksize";
import type { Bar } from "../lib/engine/types";
import type { ChannelModel } from "../lib/engine/indicators/channel/types";

const SYMBOL = "F4SMOKE";
const START = Date.UTC(2026, 2, 18, 0, 0, 0);
const H4_MS = 4 * 60 * 60 * 1000;

function buildH4Bars(): Bar[] {
  return Array.from({ length: 17 }, (_, i) => {
    const openTime = START + i * H4_MS;
    const closeTime = openTime + H4_MS - 1000;

    const base: Bar = {
      tf: "H4",
      openTime,
      closeTime,
      open: 95,
      high: 100,
      low: 90,
      close: 95,
      volume: 0,
    };

    const overrides: Record<number, Partial<Bar>> = {
      6: { open: 96, high: 101, low: 93, close: 97 },
      7: { open: 96, high: 98, low: 91, close: 94 },
      8: { open: 94, high: 97, low: 92, close: 93 },
      9: { open: 92, high: 96, low: 88, close: 90 },
      10: { open: 91, high: 96, low: 90, close: 93 },
      11: { open: 95, high: 100, low: 94, close: 95 },
      12: { open: 94, high: 106, low: 94, close: 105 },
      13: { open: 103, high: 108, low: 102, close: 106 },
      14: { open: 105, high: 107, low: 103, close: 105 },
      15: { open: 104, high: 106, low: 102, close: 104 },
      16: { open: 104, high: 106, low: 103, close: 105 },
    };

    return {
      ...base,
      ...(overrides[i] ?? {}),
    };
  });
}

function buildProvider(): ChannelModel {
  const aTime = START + 4 * H4_MS + (H4_MS - 1000);
  const bTime = START + 10 * H4_MS + (H4_MS - 1000);
  const createdAt = START + 13 * H4_MS + (H4_MS - 1000);
  const slope = (100.5 - 99.5) / (bTime - aTime);
  const intercept = 99.5 - slope * aTime;

  return {
    id: `${SYMBOL}:H4_CHANNEL:F4`,
    symbol: SYMBOL,
    type: "H4_CHANNEL",
    tf: "H4",
    state: "ACTIVE",
    mode: "ENABLED",
    geometry: {
      dir: "UP",
      anchorLine: {
        a: { time: aTime, price: 99.5 },
        b: { time: bTime, price: 100.5 },
        slope,
        intercept,
      },
      offset: 5,
      midOffset: 2.5,
    },
    anchorStartTime: aTime,
    anchorEndTime: bTime,
    createdAt,
    lastUpdatedAt: createdAt,
    maxForwardBars: 300,
    displayUntil: createdAt + 300 * H4_MS,
  };
}

function runScenario(seedProvider: boolean) {
  clearRuntimePoiStore(SYMBOL);
  setCachedTickSize(SYMBOL, 0.1);

  if (seedProvider) {
    replaceRuntimeChannelPois(SYMBOL, buildProvider());
  }

  const engine = createFvgIndicatorEngine(SYMBOL);
  const allEvents: string[] = [];

  for (const bar of buildH4Bars()) {
    allEvents.push(...engine.onBarClose(bar));
  }

  return {
    candidateEvent:
      allEvents.find((line) => line.includes("[NEW][4H][FVG][CANDIDATE]")) ?? null,
    confirmEvent:
      allEvents.find((line) => line.includes("[CONFIRM][4H][FVG][A]")) ?? null,
    deleteEvent:
      allEvents.find((line) => line.includes("[DELETE][4H][FVG][CANDIDATE]")) ?? null,
    runtimeFvgPois: listRuntimePois(SYMBOL)
      .filter((poi) => poi.kind === "FVG")
      .map((poi) => ({ id: poi.id, type: poi.type, state: poi.state })),
  };
}

function main(): void {
  const withoutProvider = runScenario(false);
  const withProvider = runScenario(true);

  assert.deepEqual(
    withoutProvider,
    {
      candidateEvent: "[NEW][4H][FVG][CANDIDATE] zone=100.0~102.0",
      confirmEvent: null,
      deleteEvent:
        "[DELETE][4H][FVG][CANDIDATE] reason=failed_confirm endTime=2026-03-20T19:59:59Z zone=100.0~102.0",
      runtimeFvgPois: [],
    },
    "fvg f4 runtime smoke deletes candidate without valid provider"
  );

  assert.deepEqual(
    withProvider,
    {
      candidateEvent: "[NEW][4H][FVG][CANDIDATE] zone=100.0~102.0",
      confirmEvent: "[CONFIRM][4H][FVG][A] tags=F1+F2+F4 zone=100.0~102.0",
      deleteEvent: null,
      runtimeFvgPois: [
        {
          id: "F4SMOKE:H4_CORE_FVG:H4:1773993599000:BULL:1000:1020",
          type: "H4_CORE_FVG",
          state: "A_ACTIVE",
        },
      ],
    },
    "fvg f4 runtime smoke confirms candidate with valid channel provider"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        withoutProvider,
        withProvider,
      },
      null,
      2
    )
  );
}

main();
