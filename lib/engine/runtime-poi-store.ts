import type {
  RouterRawPoi,
  RouterRawPoiHighlightSnapshot,
  RouterRawPoiKind,
  RouterRawPoiStore,
} from "../router/raw-event";
import type {
  TradeInvalidationRef,
  TradeInvalidationSource,
} from "../tradelifecycle/types";
import type {
  D1PoiFvg,
  H4CoreFvg,
  SetupFvg,
  StackZone,
} from "./indicators/fvg/types";
import type {
  D1PoiOb,
  H4CoreOb,
  SetupOb,
} from "./indicators/ob/types";
import { linePriceAt as getChannelLinePriceAt } from "./indicators/channel/basic";
import type { ChannelModel, ChannelPoi } from "./indicators/channel/types";
import { getTrendlineLinePriceAt } from "./indicators/trendline/lifecycle";
import type { Trendline } from "./indicators/trendline/types";

type RuntimePoiKindMap = Map<string, RouterRawPoi>;
type RuntimePoiSymbolStore = Map<RouterRawPoiKind, RuntimePoiKindMap>;
type RuntimeInvalidationSnapshot = {
  id: string;
  source: TradeInvalidationSource;
  state?: string;
  endTime?: string;
};
type RuntimeInvalidationSourceStore = Map<
  TradeInvalidationSource,
  Map<string, RuntimeInvalidationSnapshot>
>;

const runtimePoiStore = new Map<string, RuntimePoiSymbolStore>();
const runtimeChannelExecutionPoiStore = new Map<string, Map<string, RouterRawPoi>>();
const runtimeInvalidationStore = new Map<string, RuntimeInvalidationSourceStore>();

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

function ensureSymbolStore(symbol: string): RuntimePoiSymbolStore {
  const key = normalizeSymbol(symbol);
  const existing = runtimePoiStore.get(key);
  if (existing) {
    return existing;
  }

  const created: RuntimePoiSymbolStore = new Map();
  runtimePoiStore.set(key, created);
  return created;
}

function ensureChannelExecutionStore(symbol: string): Map<string, RouterRawPoi> {
  const key = normalizeSymbol(symbol);
  const existing = runtimeChannelExecutionPoiStore.get(key);
  if (existing) {
    return existing;
  }

  const created = new Map<string, RouterRawPoi>();
  runtimeChannelExecutionPoiStore.set(key, created);
  return created;
}

function ensureInvalidationStore(
  symbol: string
): RuntimeInvalidationSourceStore {
  const key = normalizeSymbol(symbol);
  const existing = runtimeInvalidationStore.get(key);
  if (existing) {
    return existing;
  }

  const created: RuntimeInvalidationSourceStore = new Map();
  runtimeInvalidationStore.set(key, created);
  return created;
}

function replaceRuntimeInvalidationSnapshots(
  symbol: string,
  source: TradeInvalidationSource,
  snapshots: readonly RuntimeInvalidationSnapshot[]
): void {
  const store = ensureInvalidationStore(symbol);
  store.set(source, new Map(snapshots.map((snapshot) => [snapshot.id, snapshot])));
}

function parseOpenTime(openTime: string): number {
  const parsed = Date.parse(openTime);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toIsoUtcSecond(time?: number): string | undefined {
  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time as number).toISOString().replace(".000Z", "Z");
}

function toRuntimeInvalidationSnapshot(args: {
  id: string;
  source: TradeInvalidationSource;
  state?: string;
  endTime?: number;
}): RuntimeInvalidationSnapshot {
  return {
    id: args.id,
    source: args.source,
    state: args.state,
    endTime: toIsoUtcSecond(args.endTime),
  };
}

function getTfDurationSec(tf: string): number {
  if (tf === "D1") {
    return 24 * 60 * 60;
  }

  if (tf === "H4") {
    return 4 * 60 * 60;
  }

  if (tf === "H1") {
    return 60 * 60;
  }

  if (tf === "M30") {
    return 30 * 60;
  }

  if (tf === "M15") {
    return 15 * 60;
  }

  return 5 * 60;
}

function toRuntimeTrendlineHighlight(line: Trendline): RouterRawPoiHighlightSnapshot {
  const shiftSec = getTfDurationSec(line.tf);

  return {
    kind: "TRENDLINE",
    poiRef: line.id,
    tf: line.tf,
    line: {
      t1: Math.floor(line.a1Time / 1000) - shiftSec,
      p1: line.a1Price,
      t2: Math.floor(line.a2Time / 1000) - shiftSec,
      p2: line.a2Price,
    },
  };
}

function toRuntimeChannelHighlight(
  model: ChannelModel
): RouterRawPoiHighlightSnapshot | null {
  if (!model.geometry) {
    return null;
  }

  return {
    kind: "CHANNEL",
    poiRef: model.id,
    tf: model.tf,
    mode: model.geometry.dir === "UP" ? "up" : "down",
    base: {
      t1: Math.floor(model.geometry.anchorLine.a.time / 1000),
      p1: model.geometry.anchorLine.a.price,
      t2: Math.floor(model.geometry.anchorLine.b.time / 1000),
      p2: model.geometry.anchorLine.b.price,
    },
    offset: model.geometry.offset,
  };
}

function getChannelBandPriceAt(
  model: ChannelModel,
  openTime: string,
  which: "lower" | "upper"
): number {
  if (!model.geometry) {
    return Number.NaN;
  }

  const time = parseOpenTime(openTime);
  if (!Number.isFinite(time)) {
    return Number.NaN;
  }

  const anchorPrice = getChannelLinePriceAt(model.geometry.anchorLine, time);
  if (model.geometry.dir === "UP") {
    return which === "lower"
      ? anchorPrice
      : anchorPrice + model.geometry.offset;
  }

  return which === "upper"
    ? anchorPrice
    : anchorPrice - model.geometry.offset;
}

function toRuntimeTrendlinePoi(line: Trendline): RouterRawPoi {
  const bestCollab =
    line.bestMatch.kind !== "NONE" && line.bestMatch.meta
      ? {
          kind: line.bestMatch.kind,
          targetId: line.bestMatch.id,
          ratioOrDist: line.bestMatch.distAtr,
          tag: line.bestMatch.meta,
        }
      : undefined;

  return {
    id: line.id,
    symbol: line.symbol,
    kind: "TRENDLINE",
    tf: line.tf,
    dir: line.type === "TL_SUPPORT" ? "BULL" : "BEAR",
    linePriceAt(openTime: string) {
      const time = parseOpenTime(openTime);
      return Number.isFinite(time)
        ? getTrendlineLinePriceAt(line, time)
        : Number.NaN;
    },
    tags: [...line.tags],
    type: line.type,
    state: line.state,
    confTime: toIsoUtcSecond(line.createdAt),
    updatedAtMs: line.lastUpdatedAt ?? line.createdAt,
    bestCollab,
    highlight: toRuntimeTrendlineHighlight(line),
  };
}

function toRuntimeTrendlineInvalidationSnapshot(
  line: Trendline
): RuntimeInvalidationSnapshot {
  return toRuntimeInvalidationSnapshot({
    id: line.id,
    source: "TRENDLINE",
    state: line.state,
    endTime: line.endTime,
  });
}

function toRuntimeChannelPoi(model: ChannelModel): RouterRawPoi | null {
  if (!model.geometry) {
    return null;
  }

  return {
    id: model.id,
    symbol: model.symbol,
    kind: "CHANNEL",
    tf: model.tf,
    dir: model.geometry.dir === "UP" ? "BULL" : "BEAR",
    lowerBandAt(openTime: string) {
      return getChannelBandPriceAt(model, openTime, "lower");
    },
    upperBandAt(openTime: string) {
      return getChannelBandPriceAt(model, openTime, "upper");
    },
    type: model.type,
    state: model.mode,
    confTime: toIsoUtcSecond(model.createdAt),
    updatedAtMs: model.lastUpdatedAt,
    highlight: toRuntimeChannelHighlight(model) ?? undefined,
  };
}

function toRuntimeChannelExecutionPoi(args: {
  poiId: string;
  model: ChannelModel;
  createdAt: number;
  tags?: readonly string[];
}): RouterRawPoi | null {
  const { poiId, model, createdAt, tags } = args;
  if (!model.geometry) {
    return null;
  }

  return {
    id: poiId,
    symbol: model.symbol,
    kind: "CHANNEL",
    tf: model.tf,
    dir: model.geometry.dir === "UP" ? "BULL" : "BEAR",
    lowerBandAt(openTime: string) {
      return getChannelBandPriceAt(model, openTime, "lower");
    },
    upperBandAt(openTime: string) {
      return getChannelBandPriceAt(model, openTime, "upper");
    },
    type: "CHANNEL_POI",
    state: "ACTIVE",
    tags: tags ? [...tags] : [],
    confTime: toIsoUtcSecond(createdAt),
    updatedAtMs: model.lastUpdatedAt,
    highlight: toRuntimeChannelHighlight(model) ?? undefined,
  };
}

function toRuntimeChannelPoiInvalidationSnapshot(
  poi: ChannelPoi
): RuntimeInvalidationSnapshot {
  return toRuntimeInvalidationSnapshot({
    id: poi.id,
    source: "CHANNEL_POI",
    state: poi.state,
    endTime: poi.endTime,
  });
}

type RuntimeFvgPoi = D1PoiFvg | H4CoreFvg | SetupFvg;
type RuntimeObPoi = D1PoiOb | H4CoreOb | SetupOb;

function isActiveRuntimeFvgPoi(poi: RuntimeFvgPoi): boolean {
  if (poi.type === "D1_POI_FVG") {
    return poi.state === "ACTIVE";
  }

  if (poi.type === "H4_CORE_FVG") {
    return poi.state === "A_ACTIVE";
  }

  return poi.state === "ACTIVE";
}

function buildFvgStackIdSet(stackZones: readonly StackZone[]): Set<string> {
  const out = new Set<string>();

  for (const stack of stackZones) {
    if (stack.state !== "ACTIVE") {
      continue;
    }

    out.add(stack.aId);
    out.add(stack.bId);
  }

  return out;
}

function toRuntimeFvgPoi(
  poi: RuntimeFvgPoi,
  stackedIds: ReadonlySet<string>
): RouterRawPoi {
  const tags = "tags" in poi && Array.isArray(poi.tags) ? poi.tags : [];

  return {
    id: poi.id,
    symbol: poi.symbol,
    kind: "FVG",
    tf: poi.tf,
    dir: poi.dir,
    zone: {
      bottom: poi.zone.bottom,
      top: poi.zone.top,
    },
    tags: [...tags],
    type: poi.type,
    state: poi.state,
    confTime: toIsoUtcSecond(poi.confTime),
    stackActive: stackedIds.has(poi.id),
  };
}

function toRuntimeFvgInvalidationSnapshot(
  poi: RuntimeFvgPoi
): RuntimeInvalidationSnapshot {
  return toRuntimeInvalidationSnapshot({
    id: poi.id,
    source: "FVG",
    state: poi.state,
    endTime: poi.endTime,
  });
}

function isActiveRuntimeObPoi(poi: RuntimeObPoi): boolean {
  if (poi.type === "D1_POI_OB") {
    return poi.state === "ACTIVE";
  }

  if (poi.type === "H4_CORE_OB") {
    return poi.state === "POI_ACTIVE";
  }

  return poi.state === "ACTIVE";
}

function getObPoiConfTime(poi: RuntimeObPoi): number {
  if (poi.type === "SETUP_OB") {
    return poi.triggerTime;
  }

  return poi.confirmDueTime ?? poi.triggerTime;
}

function toRuntimeObPoi(poi: RuntimeObPoi): RouterRawPoi {
  return {
    id: poi.id,
    symbol: poi.symbol,
    kind: "OB",
    tf: poi.tf,
    dir: poi.dir,
    zone: {
      bottom: poi.zone.bottom,
      top: poi.zone.top,
    },
    tags: [...poi.tags],
    type: poi.type,
    state: poi.state,
    confTime: toIsoUtcSecond(getObPoiConfTime(poi)),
    bestCollab: poi.bestCollab,
  };
}

function toRuntimeObInvalidationSnapshot(
  poi: RuntimeObPoi
): RuntimeInvalidationSnapshot {
  return toRuntimeInvalidationSnapshot({
    id: poi.id,
    source: "OB",
    state: poi.state,
    endTime: poi.endTime,
  });
}

export function clearRuntimePoiStore(symbol?: string): void {
  if (!symbol) {
    runtimePoiStore.clear();
    runtimeChannelExecutionPoiStore.clear();
    runtimeInvalidationStore.clear();
    return;
  }

  const key = normalizeSymbol(symbol);
  runtimePoiStore.delete(key);
  runtimeChannelExecutionPoiStore.delete(key);
  runtimeInvalidationStore.delete(key);
}

export function replaceRuntimePois(
  symbol: string,
  kind: RouterRawPoiKind,
  pois: readonly RouterRawPoi[]
): void {
  const symbolStore = ensureSymbolStore(symbol);
  symbolStore.set(
    kind,
    new Map(pois.map((poi) => [poi.id, poi]))
  );
}

export function replaceRuntimeTrendlinePois(
  symbol: string,
  lines: readonly Trendline[]
): void {
  replaceRuntimePois(
    symbol,
    "TRENDLINE",
    lines
      .filter((line) => line.state === "ACTIVE")
       .map((line) => toRuntimeTrendlinePoi(line))
  );
}

export function syncRuntimeTrendlineInvalidationPois(
  symbol: string,
  lines: readonly Trendline[]
): void {
  replaceRuntimeInvalidationSnapshots(
    symbol,
    "TRENDLINE",
    lines.map(toRuntimeTrendlineInvalidationSnapshot)
  );
}

export function replaceRuntimeChannelPois(
  symbol: string,
  models: ChannelModel | readonly ChannelModel[] | null | undefined
): void {
  const channelModels = Array.isArray(models)
    ? models
    : models
      ? [models]
      : [];

  replaceRuntimePois(
    symbol,
    "CHANNEL",
    channelModels
      .filter((model) => model.state === "ACTIVE")
      .map((model) => toRuntimeChannelPoi(model))
      .filter((poi): poi is RouterRawPoi => Boolean(poi))
  );
}

export function replaceRuntimeChannelExecutionPois(
  symbol: string,
  pois:
    | readonly {
        poiId: string;
        model: ChannelModel;
        createdAt: number;
        tags?: readonly string[];
      }[]
    | null
    | undefined
): void {
  const store = ensureChannelExecutionStore(symbol);
  store.clear();

  for (const poi of pois ?? []) {
    const runtimePoi = toRuntimeChannelExecutionPoi(poi);
    if (runtimePoi) {
      store.set(runtimePoi.id, runtimePoi);
    }
  }
}

export function syncRuntimeChannelExecutionInvalidationPois(
  symbol: string,
  pois: readonly ChannelPoi[]
): void {
  replaceRuntimeInvalidationSnapshots(
    symbol,
    "CHANNEL_POI",
    pois.map(toRuntimeChannelPoiInvalidationSnapshot)
  );
}

export function replaceRuntimeFvgPois(
  symbol: string,
  pois: readonly RuntimeFvgPoi[],
  stackZones: readonly StackZone[] = []
): void {
  const stackedIds = buildFvgStackIdSet(stackZones);

  replaceRuntimePois(
    symbol,
    "FVG",
    pois
      .filter(isActiveRuntimeFvgPoi)
      .map((poi) => toRuntimeFvgPoi(poi, stackedIds))
  );
  replaceRuntimeInvalidationSnapshots(
    symbol,
    "FVG",
    pois.map(toRuntimeFvgInvalidationSnapshot)
  );
}

export function replaceRuntimeObPois(
  symbol: string,
  pois: readonly RuntimeObPoi[]
): void {
  replaceRuntimePois(
    symbol,
    "OB",
    pois.filter(isActiveRuntimeObPoi).map(toRuntimeObPoi)
  );
  replaceRuntimeInvalidationSnapshots(
    symbol,
    "OB",
    pois.map(toRuntimeObInvalidationSnapshot)
  );
}

export function listRuntimePois(symbol: string): RouterRawPoi[] {
  const symbolStore = runtimePoiStore.get(normalizeSymbol(symbol));
  if (!symbolStore) {
    return [];
  }

  const out: RouterRawPoi[] = [];
  for (const kindStore of symbolStore.values()) {
    out.push(...kindStore.values());
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getRuntimePoiStore(symbol: string): RouterRawPoiStore {
  return {
    get(poiId: string) {
      const key = normalizeSymbol(symbol);
      const symbolStore = runtimePoiStore.get(key);
      if (!symbolStore) {
        return runtimeChannelExecutionPoiStore.get(key)?.get(poiId) ?? null;
      }

      for (const kindStore of symbolStore.values()) {
        const poi = kindStore.get(poiId);
        if (poi) {
          return poi;
        }
      }

      return runtimeChannelExecutionPoiStore.get(key)?.get(poiId) ?? null;
    },
  };
}

export function resolveRuntimeInvalidationTime(args: {
  symbol: string;
  invalidationRef: TradeInvalidationRef;
}): { invalidTime: string | null; lookupMissing: boolean } {
  const symbolStore = runtimeInvalidationStore.get(normalizeSymbol(args.symbol));
  const sourceStore = symbolStore?.get(args.invalidationRef.source);
  const snapshot = sourceStore?.get(args.invalidationRef.refId);

  if (!snapshot) {
    return {
      invalidTime: null,
      lookupMissing: true,
    };
  }

  if (
    snapshot.endTime &&
    (snapshot.state === "INACTIVE" || snapshot.state === "DELETED")
  ) {
    return {
      invalidTime: snapshot.endTime,
      lookupMissing: false,
    };
  }

  return {
    invalidTime: null,
    lookupMissing: false,
  };
}


