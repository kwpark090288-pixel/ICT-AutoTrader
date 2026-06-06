import type { Pivot } from "../engine/types";
import { uniqueLexicographicTags } from "../engine/tags";
import type { PolicyCollabStrength, SignalCandidate } from "../policy/types";
import { buildTradePlanDraft } from "../tradelifecycle/open";
import {
  computeStopBuffer,
  computeStopPrice,
} from "../tradelifecycle/open";
import { toRouterOpenIntentPoiTier, toRouterTradeDir } from "./contracts";
import type {
  RouterRawPoi,
  RouterRawSignalCandidate,
} from "./raw-event";
import type { RouterCollabStrength, RouterTf } from "./types";

const STRONG_COLLAB_TAGS = [
  "COLLAB_FVG_OVERLAP_0.30",
  "TL_COLLAB_POI_TIGHT",
  "TL_COLLAB_CHANNEL_TIGHT",
  "COLLAB_CONTEXT_TIGHT_0.10",
] as const;

const WEAK_COLLAB_TAGS = [
  "COLLAB_FVG_INSIDE_0.20",
  "TL_COLLAB_POI_OK",
  "COLLAB_CONTEXT_OK_0.25",
] as const;

export interface RouterPolicySignalCandidateContext {
  lastPrice: number;
  midPrice?: number | null;
  tickSize: number;
  ltAtr14: number;
  expectedRR: number;
  tpRefPrice: number;
}

export interface RouterPolicySignalCandidateDraftContext {
  lastPrice: number;
  midPrice?: number | null;
  tickSize: number;
  ltAtr14: number;
  atrLiq_14_atOpen: number;
  confirmedTpPivots: readonly Pivot[];
}

function isFinitePositive(value: unknown): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

function hasAnyTag(
  tags: readonly string[],
  allowed: readonly string[]
): boolean {
  return tags.some((tag) => allowed.includes(tag));
}

function getBestCollabTag(poiSnapshot?: RouterRawPoi): string | null {
  const bestCollab = poiSnapshot?.bestCollab;
  if (!bestCollab || typeof bestCollab !== "object") {
    return null;
  }

  const tag = (bestCollab as { tag?: unknown }).tag;
  return typeof tag === "string" && tag.length > 0 ? tag : null;
}

export function mapRouterPoiTier(seed: RouterRawSignalCandidate): SignalCandidate["poiTier"] {
  const snapshot = seed.poiSnapshot;
  const tf = snapshot?.tf;
  const type = snapshot?.type;
  const state = snapshot?.state;

  if (seed.poiKind === "FVG") {
    if (type === "D1_POI_FVG") return "D1_POI";
    if (type === "H4_CORE_FVG" || state === "A_ACTIVE") return "H4_CORE";
    if (type === "SETUP_FVG" || tf === "H1" || tf === "M30") return "SETUP";
    return "OTHER";
  }

  if (seed.poiKind === "OB") {
    if (type === "D1_POI_OB") return "D1_POI";
    if (type === "H4_CORE_OB" || state === "POI_ACTIVE") return "H4_CORE";
    if (type === "SETUP_OB" || tf === "H1" || tf === "M30") return "SETUP";
    return "OTHER";
  }

  if (seed.poiKind === "CHANNEL") {
    if (type === "CHANNEL_POI" && tf === "D1") {
      return tf === "D1" ? "D1_POI" : "H4_CORE";
    }
    if (type === "CHANNEL_POI" && tf === "H4") {
      return "H4_CORE";
    }
    if (type === "CHANNEL_POI" && (tf === "H1" || tf === "M30")) {
      return "SETUP";
    }
    return "OTHER";
  }

  if (seed.poiKind === "TRENDLINE") {
    if (state === "CONTEXT_ONLY") {
      return "OTHER";
    }
    if (tf === "D1" && state === "ACTIVE") return "D1_POI";
    if (tf === "H4" && state === "ACTIVE") return "H4_CORE";
    if ((tf === "H1" || tf === "M30") && state === "ACTIVE") return "SETUP";
  }

  return "OTHER";
}

export function computeRouterTriggerCount(
  seed: RouterRawSignalCandidate
): 0 | 1 | 2 | 3 {
  if (seed.triggersMode === "2plus" && seed.triggers.length === 0) {
    return 2;
  }

  const count = seed.triggers.length;
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

export function computeRouterHasStack(
  seed: RouterRawSignalCandidate
): boolean {
  return seed.poiKind === "FVG" && seed.poiSnapshot?.stackActive === true;
}

export function computeRouterCollabStrength(
  seed: RouterRawSignalCandidate
): PolicyCollabStrength {
  if (computeRouterHasStack(seed)) {
    return "STRONG";
  }

  const tags = uniqueLexicographicTags([
    ...seed.poiTags,
    ...(getBestCollabTag(seed.poiSnapshot)
      ? [getBestCollabTag(seed.poiSnapshot) as string]
      : []),
  ]);

  if (hasAnyTag(tags, STRONG_COLLAB_TAGS)) {
    return "STRONG";
  }

  if (hasAnyTag(tags, WEAK_COLLAB_TAGS)) {
    return "WEAK";
  }

  return "NONE";
}

export function buildPolicySignalCandidateFromSeed(
  seed: RouterRawSignalCandidate,
  ctx: RouterPolicySignalCandidateContext
): SignalCandidate | null {
  if (
    !Number.isFinite(ctx.lastPrice) ||
    !isFinitePositive(ctx.tickSize) ||
    !isFinitePositive(ctx.ltAtr14) ||
    !Number.isFinite(ctx.expectedRR) ||
    !Number.isFinite(ctx.tpRefPrice)
  ) {
    return null;
  }

  return {
    candidateId: seed.candidateId,
    tradeKey: seed.tradeKey,
    symbol: seed.symbol,
    time: seed.openTime,
    source: seed.poiKind,
    eventType: seed.eventName,
    dir: seed.dir,
    ltf: seed.ltf,
    poiTier: mapRouterPoiTier(seed),
    poiId: seed.poiId,
    entryBoundaryPrice: seed.entryBoundaryPrice,
    hardInvalidationPrice: seed.hardInvalidationPrice,
    lastPrice: ctx.lastPrice,
    midPrice: Number.isFinite(ctx.midPrice) ? (ctx.midPrice as number) : ctx.lastPrice,
    tickSize: ctx.tickSize,
    ltAtr14: ctx.ltAtr14,
    triggerCount: computeRouterTriggerCount(seed),
    collabStrength: computeRouterCollabStrength(seed),
    hasStack: computeRouterHasStack(seed),
    tags: seed.poiTags,
    triggers: seed.triggers,
    triggersStr: seed.triggersStr,
    poiTags: seed.poiTags,
    rawEvent: seed.rawEvent,
    poiSnapshot: seed.poiSnapshot,
    barSnapshot: seed.barSnapshot,
    expectedRR: ctx.expectedRR,
    tpRefPrice: ctx.tpRefPrice,
  };
}

function toRouterCandidateDraftTf(tf: string): RouterTf | null {
  return tf === "D1" ||
    tf === "H4" ||
    tf === "H1" ||
    tf === "M30" ||
    tf === "M15" ||
    tf === "M5"
    ? tf
    : null;
}

function toRouterCandidateDraftCollabStrength(
  collabStrength: PolicyCollabStrength
): RouterCollabStrength {
  return collabStrength;
}

export function buildPolicySignalCandidateFromSeedViaDraft(
  seed: RouterRawSignalCandidate,
  ctx: RouterPolicySignalCandidateDraftContext
): SignalCandidate | null {
  if (seed.poiKind === "CHANNEL" && seed.poiSnapshot?.kind === "CHANNEL") {
    const tpRefPrice =
      seed.dir === "BULL"
        ? seed.poiSnapshot.upperBandAt(seed.openTime)
        : seed.poiSnapshot.lowerBandAt(seed.openTime);

    const stopBuffer = computeStopBuffer(ctx.tickSize, ctx.ltAtr14);
    const stopPrice = Number.isFinite(stopBuffer)
      ? computeStopPrice(
          toRouterTradeDir(seed.dir),
          seed.entryRefPrice,
          seed.hardInvalidationPrice,
          stopBuffer as number,
          ctx.tickSize
        )
      : null;

    if (!Number.isFinite(tpRefPrice) || !Number.isFinite(stopPrice)) {
      return null;
    }

    const reward = Math.abs((tpRefPrice as number) - seed.entryRefPrice);
    const risk = Math.abs(seed.entryRefPrice - (stopPrice as number));
    if (!(risk > 0)) {
      return null;
    }

    return buildPolicySignalCandidateFromSeed(seed, {
      lastPrice: ctx.lastPrice,
      midPrice: ctx.midPrice,
      tickSize: ctx.tickSize,
      ltAtr14: ctx.ltAtr14,
      expectedRR: reward / risk,
      tpRefPrice: tpRefPrice as number,
    });
  }

  const tf = toRouterCandidateDraftTf(seed.poiTf);
  if (
    !tf ||
    !Number.isFinite(ctx.lastPrice) ||
    !isFinitePositive(ctx.tickSize) ||
    !isFinitePositive(ctx.ltAtr14) ||
    !isFinitePositive(ctx.atrLiq_14_atOpen)
  ) {
    return null;
  }

  const poiTier = mapRouterPoiTier(seed);
  const collabStrength = computeRouterCollabStrength(seed);
  const draft = buildTradePlanDraft({
    intent: {
      dir: toRouterTradeDir(seed.dir),
      openTime: seed.openTime,
      poiTier: toRouterOpenIntentPoiTier(poiTier, tf),
      entryBoundaryPrice: seed.entryBoundaryPrice,
      hardInvalidationPrice: seed.hardInvalidationPrice,
      collabStrength: toRouterCandidateDraftCollabStrength(collabStrength),
    },
    signalBarClose: ctx.lastPrice,
    tickSize: ctx.tickSize,
    atrM5_14_atOpen: ctx.ltAtr14,
    atrLiq_14_atOpen: ctx.atrLiq_14_atOpen,
    confirmedTpPivots: ctx.confirmedTpPivots,
  });

  if (!draft) {
    return null;
  }

  return buildPolicySignalCandidateFromSeed(seed, {
    lastPrice: ctx.lastPrice,
    midPrice: ctx.midPrice,
    tickSize: ctx.tickSize,
    ltAtr14: ctx.ltAtr14,
    expectedRR: draft.rrChosen,
    tpRefPrice: draft.tpPrice,
  });
}

function getEventTypePriority(eventType: SignalCandidate["eventType"]): number {
  return eventType === "ENTRY_WINDOW_OPEN" ? 2 : 1;
}

function getLtfPriority(ltf?: SignalCandidate["ltf"]): number {
  return ltf === "M15" ? 2 : ltf === "M5" ? 1 : 0;
}

function getCollabPriority(collabStrength?: PolicyCollabStrength): number {
  if (collabStrength === "STRONG") return 3;
  if (collabStrength === "WEAK") return 2;
  if (collabStrength === "NONE") return 1;
  return 0;
}

export function compareRouterCycleCandidates(
  a: SignalCandidate,
  b: SignalCandidate
): number {
  const eventPriority = getEventTypePriority(b.eventType) - getEventTypePriority(a.eventType);
  if (eventPriority !== 0) return eventPriority;

  const ltfPriority = getLtfPriority(b.ltf) - getLtfPriority(a.ltf);
  if (ltfPriority !== 0) return ltfPriority;

  const triggerCountDelta = (b.triggerCount ?? 0) - (a.triggerCount ?? 0);
  if (triggerCountDelta !== 0) return triggerCountDelta;

  const collabDelta = getCollabPriority(b.collabStrength) - getCollabPriority(a.collabStrength);
  if (collabDelta !== 0) return collabDelta;

  return (a.candidateId ?? "").localeCompare(b.candidateId ?? "");
}

export function selectStrongestRouterCycleCandidate(
  candidates: readonly SignalCandidate[]
): SignalCandidate | null {
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort(compareRouterCycleCandidates)[0] ?? null;
}

export interface RouterTradeKeyStatusRef {
  tradeKey: string;
  status: "OPEN" | "CLOSING" | "CLOSED";
}

export function groupRouterCycleCandidatesByTradeKey(
  candidates: readonly SignalCandidate[]
): Map<string, SignalCandidate[]> {
  const out = new Map<string, SignalCandidate[]>();

  for (const candidate of candidates) {
    const tradeKey = candidate.tradeKey;
    if (!tradeKey) {
      continue;
    }

    const bucket = out.get(tradeKey);
    if (bucket) {
      bucket.push(candidate);
      continue;
    }

    out.set(tradeKey, [candidate]);
  }

  return out;
}

export function coalesceRouterCycleCandidates(
  candidates: readonly SignalCandidate[]
): SignalCandidate[] {
  const grouped = groupRouterCycleCandidatesByTradeKey(candidates);
  const winners: SignalCandidate[] = [];

  for (const bucket of grouped.values()) {
    const winner = selectStrongestRouterCycleCandidate(bucket);
    if (winner) {
      winners.push(winner);
    }
  }

  return winners.sort((a, b) => (a.tradeKey ?? "").localeCompare(b.tradeKey ?? ""));
}

export function hasActiveTradeKey(
  tradeKey: string,
  refs: readonly RouterTradeKeyStatusRef[]
): boolean {
  return refs.some(
    (ref) =>
      ref.tradeKey === tradeKey &&
      (ref.status === "OPEN" || ref.status === "CLOSING")
  );
}

export function filterRouterCycleSendOpenCandidates(
  candidates: readonly SignalCandidate[],
  activeRefs: readonly RouterTradeKeyStatusRef[]
): SignalCandidate[] {
  return coalesceRouterCycleCandidates(candidates).filter(
    (candidate) =>
      !candidate.tradeKey || !hasActiveTradeKey(candidate.tradeKey, activeRefs)
  );
}
