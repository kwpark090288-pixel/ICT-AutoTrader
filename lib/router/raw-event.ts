import { uniqueLexicographicTags } from "../engine/tags";
import { decimalsFromTick } from "../engine/tick";

export type ParsedEventLine = {
  raw: string;
  header: string[];
  kv: Record<string, string>;
  extras: string[];
  errors: string[];
};

export type RouterRawEventName = "REACTION" | "ENTRY_WINDOW_OPEN";
export type RouterRawEventLtf = "M5" | "M15";
export type RouterRawPoiKind = "OB" | "FVG" | "CHANNEL" | "TRENDLINE";
export type RouterRawDir = "BULL" | "BEAR";

export type ParsedTriggers = {
  raw: string;
  mode: "2plus" | "raw";
  tokens: string[];
};

export interface RouterRawEventBarContext {
  closeTime: string | number;
  close: number;
  high: number;
  low: number;
  closePriceBasis?: number;
}

type RouterZone = {
  bottom: number;
  top: number;
};

export type RouterRawPoiLineSnapshot = {
  t1: number;
  p1: number;
  t2: number;
  p2: number;
};

export type RouterRawPoiHighlightSnapshot =
  | {
      kind: "TRENDLINE";
      poiRef: string;
      tf: string;
      line: RouterRawPoiLineSnapshot;
    }
  | {
      kind: "CHANNEL";
      poiRef: string;
      tf: string;
      mode: "up" | "down";
      base: RouterRawPoiLineSnapshot;
      offset: number;
    };

interface BaseRouterRawPoi {
  id: string;
  symbol: string;
  kind: RouterRawPoiKind;
  tf: string;
  tags?: string[];
  type?: string;
  state?: string;
  confTime?: string;
  updatedAtMs?: number;
  bestCollab?: unknown;
  stackActive?: boolean;
}

export type RouterRawPoi =
  | (BaseRouterRawPoi & {
      kind: "OB" | "FVG";
      dir: RouterRawDir;
      zone: RouterZone;
    })
  | (BaseRouterRawPoi & {
      kind: "CHANNEL";
      dir: RouterRawDir;
      lowerBandAt: (openTime: string) => number;
      upperBandAt: (openTime: string) => number;
      highlight?: RouterRawPoiHighlightSnapshot;
    })
  | (BaseRouterRawPoi & {
      kind: "TRENDLINE";
      dir: RouterRawDir;
      linePriceAt: (openTime: string) => number;
      highlight?: RouterRawPoiHighlightSnapshot;
    });

export interface RouterRawPoiStore {
  get(poiId: string): RouterRawPoi | null | undefined;
}

export interface RouterRawEventContext {
  symbol: string;
  bar: RouterRawEventBarContext;
  tickSize: number;
  poiStore: RouterRawPoiStore;
}

export interface RouterRawSignalCandidate {
  candidateId: string;
  tradeKey: string;

  symbol: string;
  ltf: RouterRawEventLtf;
  eventName: RouterRawEventName;
  openTime: string;

  poiId: string;
  poiKind: RouterRawPoiKind;
  poiTf: string;
  dir: RouterRawDir;
  triggersMode: "2plus" | "raw";

  entryRefPrice: number;
  entryBoundaryPrice: number;
  hardInvalidationPrice: number;

  triggers: string[];
  triggersStr: string;

  poiTags: string[];
  rawEvent: string;

  poiSnapshot?: RouterRawPoi;
  barSnapshot?: {
    close: number;
    high: number;
    low: number;
  };
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROUTER_RAW_EVENT_NAMES = [
  "REACTION",
  "ENTRY_WINDOW_OPEN",
] as const satisfies readonly RouterRawEventName[];
const ROUTER_RAW_EVENT_LTFS = ["M5", "M15"] as const satisfies readonly RouterRawEventLtf[];

function isRouterRawEventName(value: string): value is RouterRawEventName {
  return (ROUTER_RAW_EVENT_NAMES as readonly string[]).includes(value);
}

function isRouterRawEventLtf(value: string): value is RouterRawEventLtf {
  return (ROUTER_RAW_EVENT_LTFS as readonly string[]).includes(value);
}

function toIsoUtc(value: string | number): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    return new Date(value).toISOString().replace(".000Z", "Z");
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString().replace(".000Z", "Z");
}

function roundToTick(value: number, tickSize: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return Number.NaN;
  }

  const decimals = decimalsFromTick(tickSize);
  return Number((Math.round(value / tickSize) * tickSize).toFixed(decimals));
}

function getClosePriceBasis(bar: RouterRawEventBarContext): number {
  return Number.isFinite(bar.closePriceBasis) ? (bar.closePriceBasis as number) : bar.close;
}

function getEntryBoundaryPrice(
  poi: RouterRawPoi,
  openTime: string
): number {
  switch (poi.kind) {
    case "FVG":
    case "OB":
      return poi.dir === "BULL" ? poi.zone.bottom : poi.zone.top;
    case "CHANNEL":
      return poi.dir === "BULL"
        ? poi.lowerBandAt(openTime)
        : poi.upperBandAt(openTime);
    case "TRENDLINE":
      return poi.linePriceAt(openTime);
  }
}

function getHardInvalidationPrice(
  poi: RouterRawPoi,
  openTime: string
): number {
  switch (poi.kind) {
    case "FVG":
    case "OB":
      return poi.dir === "BULL" ? poi.zone.bottom : poi.zone.top;
    case "CHANNEL":
      return poi.dir === "BULL"
        ? poi.lowerBandAt(openTime)
        : poi.upperBandAt(openTime);
    case "TRENDLINE":
      return poi.linePriceAt(openTime);
  }
}

export function parseEventLine(rawLine: string): ParsedEventLine {
  const raw = (rawLine ?? "").trim();
  const out: ParsedEventLine = {
    raw,
    header: [],
    kv: {},
    extras: [],
    errors: [],
  };

  if (!raw) {
    out.errors.push("EMPTY_LINE");
    return out;
  }

  let i = 0;
  while (i < raw.length && raw[i] === "[") {
    const j = raw.indexOf("]", i + 1);
    if (j < 0) {
      out.errors.push("UNTERMINATED_BRACKET");
      break;
    }

    out.header.push(raw.slice(i + 1, j));
    i = j + 1;
  }

  if (out.header.length === 0) {
    out.errors.push("NO_HEADER_TOKENS");
    return out;
  }

  const rest = raw.slice(i).trim();
  if (!rest) {
    return out;
  }

  for (const part of rest.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) {
      out.extras.push(part);
      continue;
    }

    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);

    if (!KEY_RE.test(key)) {
      out.extras.push(part);
      out.errors.push(`INVALID_KEY:${key}`);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(out.kv, key)) {
      out.errors.push(`DUPLICATE_KEY:${key}`);
      continue;
    }

    out.kv[key] = value;
  }

  return out;
}

export function getPoiId(kv: Record<string, string>): string | null {
  const poi = kv["poi"]?.trim();
  if (poi) {
    return poi;
  }

  const insidePoi = kv["insidePOI"]?.trim();
  return insidePoi || null;
}

export function normalizeTokenList(value: string): string[] {
  const raw = (value ?? "").trim();
  if (!raw) {
    return [];
  }

  return uniqueLexicographicTags(
    raw
      .split(/[|+,]/g)
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

export function parseTriggers(value: string): ParsedTriggers {
  const raw = (value ?? "").trim();
  let mode: "2plus" | "raw" = "raw";
  let body = raw;

  if (raw === "2plus") {
    mode = "2plus";
    body = "";
  } else if (raw.startsWith("2plus:")) {
    mode = "2plus";
    body = raw.slice("2plus:".length);
  }

  return {
    raw,
    mode,
    tokens: normalizeTokenList(body),
  };
}

export function buildRouterRawTradeKey(
  symbol: string,
  poiId: string,
  dir: RouterRawDir
): string {
  return `${symbol}:${poiId}:${dir}`;
}

export function buildRouterRawCandidateId(
  tradeKey: string,
  eventName: RouterRawEventName,
  ltf: RouterRawEventLtf,
  openTime: string
): string {
  return `${tradeKey}:${eventName}:${ltf}@${openTime}`;
}

export function toRouterRawSignalCandidate(
  rawEvent: string,
  ctx: RouterRawEventContext
): RouterRawSignalCandidate | null {
  const parsed = parseEventLine(rawEvent);
  const eventName = parsed.header[0];
  const ltf = parsed.header[1];

  if (!isRouterRawEventName(eventName)) {
    return null;
  }

  if (!isRouterRawEventLtf(ltf)) {
    return null;
  }

  const poiId = getPoiId(parsed.kv);
  if (!poiId) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(parsed.kv, "triggers")) {
    return null;
  }

  const poi = ctx.poiStore.get(poiId);
  if (!poi) {
    return null;
  }

  const openTime = toIsoUtc(ctx.bar.closeTime);
  if (!openTime) {
    return null;
  }

  const entryRefPrice = roundToTick(getClosePriceBasis(ctx.bar), ctx.tickSize);
  const entryBoundaryPrice = roundToTick(
    getEntryBoundaryPrice(poi, openTime),
    ctx.tickSize
  );
  const hardInvalidationPrice = roundToTick(
    getHardInvalidationPrice(poi, openTime),
    ctx.tickSize
  );

  if (
    !Number.isFinite(entryRefPrice) ||
    !Number.isFinite(entryBoundaryPrice) ||
    !Number.isFinite(hardInvalidationPrice)
  ) {
    return null;
  }

  const parsedTriggers = parseTriggers(parsed.kv["triggers"]);
  const triggers = parsedTriggers.tokens;
  const poiTags = uniqueLexicographicTags(poi.tags ?? []);
  const tradeKey = buildRouterRawTradeKey(ctx.symbol, poiId, poi.dir);

  return {
    candidateId: buildRouterRawCandidateId(tradeKey, eventName, ltf, openTime),
    tradeKey,
    symbol: ctx.symbol,
    ltf,
    eventName,
    openTime,
    poiId,
    poiKind: poi.kind,
    poiTf: poi.tf,
    dir: poi.dir,
    triggersMode: parsedTriggers.mode,
    entryRefPrice,
    entryBoundaryPrice,
    hardInvalidationPrice,
    triggers,
    triggersStr: triggers.join("|"),
    poiTags,
    rawEvent,
    poiSnapshot: poi,
    barSnapshot: {
      close: getClosePriceBasis(ctx.bar),
      high: ctx.bar.high,
      low: ctx.bar.low,
    },
  };
}
