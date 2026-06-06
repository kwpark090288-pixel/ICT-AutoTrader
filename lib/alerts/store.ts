import {
  ALERT_GROUP_MIN_COUNT,
  ALERT_GROUP_WINDOW_MIN,
  DEFAULT_ALERT_PROFILE_ID,
} from "./constants";
import {
  applyOtherInboxFilters,
  applySelectedFeedFilters,
} from "./filters";
import type {
  OtherInboxFilterState,
  AlertSeenTab,
  ReviewNoteRecord,
  SelectedFeedFilterState,
  SignalFeedItem,
  SoundPlayEvalResult,
  StoredSignalEvent,
  StoredSignalEventWithSeen,
  UiMuteStateRecord,
  UiSeenStateRecord,
  UiSoundPlayedRecord,
  UiSoundPreferenceRecord,
} from "./types";

type ListSignalEventsArgs = {
  symbol?: string;
  limit?: number;
};

type UpsertSeenStateArgs = {
  profileId?: string;
  eventId: string;
  seenAtUtc?: string;
};

type ListSignalEventsWithSeenArgs = {
  profileId?: string;
  symbol?: string;
  excludeSymbol?: string;
  limit: number;
  tab?: AlertSeenTab;
  mutedKeys?: Set<string>;
};

type ListSelectedSymbolEventsArgs = {
  profileId?: string;
  symbol: string;
  limit: number;
  filterState?: SelectedFeedFilterState;
};

type ListOtherInboxEventsArgs = {
  profileId?: string;
  selectedSymbol: string;
  limit: number;
  filterState?: OtherInboxFilterState;
  mutedKeys?: Set<string>;
};

type ComputeUnseenHighCountOtherArgs = {
  profileId?: string;
  selectedSymbol: string;
  mutedKeys?: Set<string>;
};

type UpsertMuteStateArgs = {
  profileId?: string;
  symbol: string;
  tf: string;
  muteUntilUtc: string;
};

type GetSoundPreferenceResult = {
  profileId: string;
  enabled: boolean;
  updatedAtUtc: string | null;
};

const storedSignalEvents: StoredSignalEvent[] = [];
const reviewNotesByPlanId = new Map<string, ReviewNoteRecord>();
const uiSeenState = new Map<string, UiSeenStateRecord>();
const uiMuteState = new Map<string, UiMuteStateRecord>();
const uiSoundPrefs = new Map<string, UiSoundPreferenceRecord>();
const uiSoundPlayed = new Map<string, UiSoundPlayedRecord>();
let alertsPrismaUnavailable = false;
let alertsPrismaUnavailableLogged = false;

function parseIsoUtcMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function formatIsoUtc(value: Date | string): string {
  const iso =
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return iso.replace(".000Z", "Z");
}

function normalizeProfileId(profileId?: string): string {
  if (typeof profileId === "string" && profileId.trim().length > 0) {
    return profileId;
  }

  return DEFAULT_ALERT_PROFILE_ID;
}

async function getAlertsPrisma() {
  if (alertsPrismaUnavailable) {
    return null;
  }

  try {
    const mod = await import("../db/prisma");
    return mod.prisma;
  } catch (error) {
    alertsPrismaUnavailable = true;

    if (!alertsPrismaUnavailableLogged) {
      alertsPrismaUnavailableLogged = true;
      console.error("[ALERTS_STORE_PRISMA_UNAVAILABLE]", error);
    }

    return null;
  }
}

function toStoredSignalEventWithSeen(
  event: StoredSignalEvent,
  seen: boolean
): StoredSignalEventWithSeen {
  return {
    ...event,
    weaknessCodes: event.weaknessCodes ? [...event.weaknessCodes] : undefined,
    seen,
  };
}

export function withSeenProjectionFromSource(
  events: readonly StoredSignalEvent[],
  args: {
    profileId?: string;
    symbol?: string;
    excludeSymbol?: string;
    tab?: AlertSeenTab;
    mutedKeys?: Set<string>;
  } = {}
): StoredSignalEventWithSeen[] {
  const {
    profileId,
    symbol,
    excludeSymbol,
    tab = "All",
    mutedKeys = new Set<string>(),
  } = args;

  const normalizedSymbol = symbol?.toUpperCase();
  const normalizedExcludeSymbol = excludeSymbol?.toUpperCase();

  const filtered = events.filter((event) => {
    if (normalizedSymbol && event.symbol.toUpperCase() !== normalizedSymbol) {
      return false;
    }

    if (
      normalizedExcludeSymbol &&
      event.symbol.toUpperCase() === normalizedExcludeSymbol
    ) {
      return false;
    }

    if (mutedKeys.has(`${event.symbol}|${event.tf}`)) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    return parseIsoUtcMs(b.time) - parseIsoUtcMs(a.time);
  });

  const withSeen = sorted.map((event) => {
    return toStoredSignalEventWithSeen(
      event,
      isSeen(profileId, event.id)
    );
  });

  return tab === "Unread" ? withSeen.filter((event) => !event.seen) : withSeen;
}

export function withSeenProjectionFromSourceWithState(
  events: readonly StoredSignalEvent[],
  args: {
    symbol?: string;
    excludeSymbol?: string;
    tab?: AlertSeenTab;
    mutedKeys?: Set<string>;
    seenEventIds?: Set<string>;
  } = {}
): StoredSignalEventWithSeen[] {
  const {
    symbol,
    excludeSymbol,
    tab = "All",
    mutedKeys = new Set<string>(),
    seenEventIds = new Set<string>(),
  } = args;

  const normalizedSymbol = symbol?.toUpperCase();
  const normalizedExcludeSymbol = excludeSymbol?.toUpperCase();

  const filtered = events.filter((event) => {
    if (normalizedSymbol && event.symbol.toUpperCase() !== normalizedSymbol) {
      return false;
    }

    if (
      normalizedExcludeSymbol &&
      event.symbol.toUpperCase() === normalizedExcludeSymbol
    ) {
      return false;
    }

    if (mutedKeys.has(`${event.symbol}|${event.tf}`)) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    return parseIsoUtcMs(b.time) - parseIsoUtcMs(a.time);
  });

  const withSeen = sorted.map((event) => {
    return toStoredSignalEventWithSeen(event, seenEventIds.has(event.id));
  });

  return tab === "Unread" ? withSeen.filter((event) => !event.seen) : withSeen;
}

function normalizeSignalSeverity(
  severity?: string
): "HIGH" | "MID" | "LOW" {
  if (severity === "HIGH" || severity === "MID") {
    return severity;
  }

  return "LOW";
}

export function appendSignalEvent(
  event: StoredSignalEvent
): void {
  storedSignalEvents.push({
    ...event,
    weaknessCodes: event.weaknessCodes ? [...event.weaknessCodes] : undefined,
  });
}

export function listSignalEvents(
  args: ListSignalEventsArgs = {}
): StoredSignalEvent[] {
  const { symbol, limit } = args;
  const normalizedSymbol = symbol?.toUpperCase();

  const filtered = storedSignalEvents.filter((event) => {
    if (!normalizedSymbol) {
      return true;
    }

    return event.symbol.toUpperCase() === normalizedSymbol;
  });

  const sorted = [...filtered].sort((a, b) => {
    return parseIsoUtcMs(b.time) - parseIsoUtcMs(a.time);
  });

  if (!Number.isFinite(limit) || (limit as number) <= 0) {
    return sorted;
  }

  return sorted.slice(0, Math.floor(limit as number));
}

export function getReviewNote(
  planId: string
): ReviewNoteRecord | null {
  return reviewNotesByPlanId.get(planId) ?? null;
}

export function upsertReviewNote(
  planId: string,
  text: string,
  nowUtc: string
): ReviewNoteRecord {
  const record: ReviewNoteRecord = {
    planId,
    reviewNoteText: text,
    reviewNoteUpdatedAtUtc: nowUtc,
  };

  reviewNotesByPlanId.set(planId, record);
  return record;
}

export function buildSeenStateKey(
  profileId: string,
  eventId: string
): string {
  return `${profileId}|${eventId}`;
}

export function upsertSeenState(
  args: UpsertSeenStateArgs
): UiSeenStateRecord {
  const profileId = normalizeProfileId(args.profileId);
  const seenAtUtc = args.seenAtUtc ?? new Date().toISOString();

  const record: UiSeenStateRecord = {
    profileId,
    eventId: args.eventId,
    seenAtUtc,
  };

  uiSeenState.set(buildSeenStateKey(profileId, args.eventId), record);
  return record;
}

export function getSeenState(
  profileId: string | undefined,
  eventId: string
): UiSeenStateRecord | null {
  const normalizedProfileId = normalizeProfileId(profileId);
  return uiSeenState.get(
    buildSeenStateKey(normalizedProfileId, eventId)
  ) ?? null;
}

export function isSeen(
  profileId: string | undefined,
  eventId: string
): boolean {
  return getSeenState(profileId, eventId) !== null;
}

export function listSignalEventsWithSeen(
  args: ListSignalEventsWithSeenArgs
): StoredSignalEventWithSeen[] {
  const { limit } = args;
  const tabFiltered = withSeenProjectionFromSource(storedSignalEvents, args);

  if (!Number.isFinite(limit) || limit <= 0) {
    return tabFiltered;
  }

  return tabFiltered.slice(0, Math.floor(limit));
}

export function listSelectedSymbolEvents(
  args: ListSelectedSymbolEventsArgs
): StoredSignalEventWithSeen[] {
  const {
    symbol,
    limit,
    filterState = {
      eventType: "ALL",
    },
  } = args;

  const events = withSeenProjectionFromSource(storedSignalEvents, {
    profileId: args.profileId,
    symbol,
    tab: "All",
  });

  const filtered = applySelectedFeedFilters(events, filterState);

  if (!Number.isFinite(limit) || limit <= 0) {
    return filtered;
  }

  return filtered.slice(0, Math.floor(limit));
}

export function listOtherInboxEvents(
  args: ListOtherInboxEventsArgs
): StoredSignalEventWithSeen[] {
  const {
    selectedSymbol,
    limit,
    filterState = {
      tab: "All",
      eventType: "ALL",
      severity: "ALL",
    },
    mutedKeys = new Set<string>(),
  } = args;

  const events = withSeenProjectionFromSource(storedSignalEvents, {
    profileId: args.profileId,
    excludeSymbol: selectedSymbol,
    tab: "All",
    mutedKeys,
  });

  const filtered = applyOtherInboxFilters(events, filterState);

  if (!Number.isFinite(limit) || limit <= 0) {
    return filtered;
  }

  return filtered.slice(0, Math.floor(limit));
}

export function listSelectedSymbolEventsFromSource(args: {
  events: readonly StoredSignalEvent[];
  profileId?: string;
  symbol: string;
  limit: number;
  filterState?: SelectedFeedFilterState;
}): StoredSignalEventWithSeen[] {
  const {
    events,
    symbol,
    limit,
    filterState = {
      eventType: "ALL",
    },
  } = args;

  const withSeen = withSeenProjectionFromSource(events, {
    profileId: args.profileId,
    symbol,
    tab: "All",
  });

  const filtered = applySelectedFeedFilters(withSeen, filterState);

  if (!Number.isFinite(limit) || limit <= 0) {
    return filtered;
  }

  return filtered.slice(0, Math.floor(limit));
}

export function listOtherInboxEventsFromSource(args: {
  events: readonly StoredSignalEvent[];
  profileId?: string;
  selectedSymbol: string;
  limit: number;
  filterState?: OtherInboxFilterState;
  mutedKeys?: Set<string>;
}): StoredSignalEventWithSeen[] {
  const {
    events,
    selectedSymbol,
    limit,
    filterState = {
      tab: "All",
      eventType: "ALL",
      severity: "ALL",
    },
    mutedKeys = new Set<string>(),
  } = args;

  const withSeen = withSeenProjectionFromSource(events, {
    profileId: args.profileId,
    excludeSymbol: selectedSymbol,
    tab: "All",
    mutedKeys,
  });

  const filtered = applyOtherInboxFilters(withSeen, filterState);

  if (!Number.isFinite(limit) || limit <= 0) {
    return filtered;
  }

  return filtered.slice(0, Math.floor(limit));
}

export function buildSignalGroupKey(
  event: StoredSignalEventWithSeen
): string {
  return `${event.symbol}|${event.tf}|${event.type}|${event.direction}`;
}

export function getSignalSeverityRank(
  severity: string | undefined
): number {
  if (severity === "HIGH") {
    return 3;
  }

  if (severity === "MID") {
    return 2;
  }

  return 1;
}

export function groupSignalEvents(
  events: readonly StoredSignalEventWithSeen[]
): SignalFeedItem[] {
  const items: SignalFeedItem[] = [];
  const windowMs = ALERT_GROUP_WINDOW_MIN * 60 * 1000;

  for (let index = 0; index < events.length;) {
    const anchor = events[index];
    const anchorTimeMs = parseIsoUtcMs(anchor.time);
    const anchorGroupKey = buildSignalGroupKey(anchor);
    const cluster: StoredSignalEventWithSeen[] = [anchor];

    let nextIndex = index + 1;
    while (nextIndex < events.length) {
      const candidate = events[nextIndex];
      const candidateGroupKey = buildSignalGroupKey(candidate);
      const candidateTimeMs = parseIsoUtcMs(candidate.time);

      if (
        candidateGroupKey !== anchorGroupKey ||
        anchorTimeMs - candidateTimeMs > windowMs
      ) {
        break;
      }

      cluster.push(candidate);
      nextIndex += 1;
    }

    if (cluster.length >= ALERT_GROUP_MIN_COUNT) {
      const highestSeverity = cluster.reduce<"HIGH" | "MID" | "LOW">(
        (best, event) => {
          return getSignalSeverityRank(event.severity) >
            getSignalSeverityRank(best)
            ? normalizeSignalSeverity(event.severity)
            : best;
        },
        "LOW"
      );

      items.push({
        kind: "group",
        group: {
          groupKey: anchorGroupKey,
          symbol: anchor.symbol,
          tf: anchor.tf,
          eventType: anchor.type,
          direction: anchor.direction,
          count: cluster.length,
          latestTime: cluster[0].time,
          earliestTime: cluster[cluster.length - 1].time,
          severity: highestSeverity,
          eventIds: cluster.map((event) => event.id),
          seen: cluster.every((event) => event.seen),
          unseenCount: cluster.filter((event) => !event.seen).length,
        },
      });
    } else {
      for (const event of cluster) {
        items.push({
          kind: "event",
          event,
        });
      }
    }

    index = nextIndex;
  }

  return items;
}

export function computeUnseenHighCountOther(
  args: ComputeUnseenHighCountOtherArgs
): number {
  return computeUnseenHighCountOtherFromSource(storedSignalEvents, args);
}

export function computeUnseenHighCountOtherFromSource(
  events: readonly StoredSignalEvent[],
  args: ComputeUnseenHighCountOtherArgs
): number {
  const {
    profileId,
    selectedSymbol,
    mutedKeys = new Set<string>(),
  } = args;

  const normalizedSelectedSymbol = selectedSymbol.toUpperCase();

  return events.reduce((count, event) => {
    const muteKey = `${event.symbol}|${event.tf}`;
    if (isSeen(profileId, event.id)) {
      return count;
    }

    if (event.severity !== "HIGH") {
      return count;
    }

    if (event.symbol.toUpperCase() === normalizedSelectedSymbol) {
      return count;
    }

    if (mutedKeys.has(muteKey)) {
      return count;
    }

    return count + 1;
  }, 0);
}

export function computeUnseenHighCountOtherFromSourceWithState(
  events: readonly StoredSignalEvent[],
  args: {
    selectedSymbol: string;
    mutedKeys?: Set<string>;
    seenEventIds?: Set<string>;
  }
): number {
  const {
    selectedSymbol,
    mutedKeys = new Set<string>(),
    seenEventIds = new Set<string>(),
  } = args;

  const normalizedSelectedSymbol = selectedSymbol.toUpperCase();

  return events.reduce((count, event) => {
    const muteKey = `${event.symbol}|${event.tf}`;
    if (seenEventIds.has(event.id)) {
      return count;
    }

    if (event.severity !== "HIGH") {
      return count;
    }

    if (event.symbol.toUpperCase() === normalizedSelectedSymbol) {
      return count;
    }

    if (mutedKeys.has(muteKey)) {
      return count;
    }

    return count + 1;
  }, 0);
}

export function buildMuteStateKey(
  profileId: string,
  symbol: string,
  tf: string
): string {
  return `${profileId}|${symbol}|${tf}`;
}

export function upsertMuteState(
  args: UpsertMuteStateArgs
): UiMuteStateRecord {
  const profileId = normalizeProfileId(args.profileId);
  const record: UiMuteStateRecord = {
    profileId,
    symbol: args.symbol,
    tf: args.tf,
    muteUntilUtc: args.muteUntilUtc,
  };

  uiMuteState.set(
    buildMuteStateKey(profileId, args.symbol, args.tf),
    record
  );

  return record;
}

export function getMuteState(
  profileId: string | undefined,
  symbol: string,
  tf: string
): UiMuteStateRecord | null {
  const normalizedProfileId = normalizeProfileId(profileId);

  return uiMuteState.get(
    buildMuteStateKey(normalizedProfileId, symbol, tf)
  ) ?? null;
}

export function clearMuteState(
  profileId: string | undefined,
  symbol: string,
  tf: string
): boolean {
  const normalizedProfileId = normalizeProfileId(profileId);

  return uiMuteState.delete(
    buildMuteStateKey(normalizedProfileId, symbol, tf)
  );
}

export function isMuted(
  profileId: string | undefined,
  symbol: string,
  tf: string,
  nowUtc?: string
): boolean {
  const record = getMuteState(profileId, symbol, tf);
  if (!record) {
    return false;
  }

  const nowMs = parseIsoUtcMs(nowUtc ?? new Date().toISOString());
  const muteUntilMs = parseIsoUtcMs(record.muteUntilUtc);

  if (!Number.isFinite(nowMs) || !Number.isFinite(muteUntilMs)) {
    return false;
  }

  return nowMs < muteUntilMs;
}

export function listActiveMuteStates(
  profileId: string | undefined,
  nowUtc?: string
): UiMuteStateRecord[] {
  const normalizedProfileId = normalizeProfileId(profileId);
  const nowMs = parseIsoUtcMs(nowUtc ?? new Date().toISOString());

  return [...uiMuteState.values()]
    .filter((record) => {
      return (
        record.profileId === normalizedProfileId &&
        nowMs < parseIsoUtcMs(record.muteUntilUtc)
      );
    })
    .sort((a, b) => {
      return parseIsoUtcMs(a.muteUntilUtc) - parseIsoUtcMs(b.muteUntilUtc);
    });
}

export function buildMutedKeySet(
  profileId: string | undefined,
  nowUtc?: string
): Set<string> {
  return new Set(
    listActiveMuteStates(profileId, nowUtc).map((record) => {
      return `${record.symbol}|${record.tf}`;
    })
  );
}

export function buildSoundPlayedKey(
  profileId: string,
  eventId: string
): string {
  return `${profileId}|${eventId}`;
}

export function getSoundPreference(
  profileId?: string
): GetSoundPreferenceResult {
  const normalizedProfileId = normalizeProfileId(profileId);
  const record = uiSoundPrefs.get(normalizedProfileId);

  if (!record) {
    return {
      profileId: normalizedProfileId,
      enabled: false,
      updatedAtUtc: null,
    };
  }

  return record;
}

export function upsertSoundPreference(
  profileId: string | undefined,
  enabled: boolean,
  updatedAtUtc?: string
): UiSoundPreferenceRecord {
  const normalizedProfileId = normalizeProfileId(profileId);
  const record: UiSoundPreferenceRecord = {
    profileId: normalizedProfileId,
    enabled,
    updatedAtUtc: updatedAtUtc ?? new Date().toISOString(),
  };

  uiSoundPrefs.set(normalizedProfileId, record);
  return record;
}

export function getSoundPlayed(
  profileId: string | undefined,
  eventId: string
): UiSoundPlayedRecord | null {
  const normalizedProfileId = normalizeProfileId(profileId);
  return uiSoundPlayed.get(
    buildSoundPlayedKey(normalizedProfileId, eventId)
  ) ?? null;
}

export function markSoundPlayed(
  profileId: string | undefined,
  eventId: string,
  playedAtUtc?: string
): UiSoundPlayedRecord {
  const normalizedProfileId = normalizeProfileId(profileId);
  const record: UiSoundPlayedRecord = {
    profileId: normalizedProfileId,
    eventId,
    playedAtUtc: playedAtUtc ?? new Date().toISOString(),
  };

  uiSoundPlayed.set(
    buildSoundPlayedKey(normalizedProfileId, eventId),
    record
  );

  return record;
}

export function hasSoundPlayed(
  profileId: string | undefined,
  eventId: string
): boolean {
  return getSoundPlayed(profileId, eventId) !== null;
}

export async function getPersistedReviewNote(
  planId: string
): Promise<ReviewNoteRecord | null> {
  const fallback = getReviewNote(planId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.reviewNote.findFirst({
      where: { planId },
      orderBy: { createdAt: "desc" },
    });

    if (!row) {
      return fallback;
    }

    return {
      planId: row.planId,
      reviewNoteText: row.noteText,
      reviewNoteUpdatedAtUtc: formatIsoUtc(row.createdAt),
    };
  } catch (error) {
    console.error("[ALERTS_REVIEW_NOTE_GET_ERROR]", error);
    return fallback;
  }
}

export async function upsertPersistedReviewNote(
  planId: string,
  text: string,
  nowUtc: string
): Promise<ReviewNoteRecord> {
  const fallback = upsertReviewNote(planId, text, nowUtc);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.reviewNote.create({
      data: {
        planId,
        noteText: text,
        createdAt: new Date(nowUtc),
      },
    });

    return {
      planId: row.planId,
      reviewNoteText: row.noteText,
      reviewNoteUpdatedAtUtc: formatIsoUtc(row.createdAt),
    };
  } catch (error) {
    console.error("[ALERTS_REVIEW_NOTE_UPSERT_ERROR]", error);
    return fallback;
  }
}

export async function getPersistedSeenState(
  profileId: string | undefined,
  eventId: string
): Promise<UiSeenStateRecord | null> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const fallback = getSeenState(normalizedProfileId, eventId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.seenState.findUnique({
      where: {
        profileId_eventId: {
          profileId: normalizedProfileId,
          eventId,
        },
      },
    });

    if (!row) {
      return fallback;
    }

    return {
      profileId: row.profileId,
      eventId: row.eventId,
      seenAtUtc: formatIsoUtc(row.seenAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SEEN_GET_ERROR]", error);
    return fallback;
  }
}

export async function upsertPersistedSeenState(
  args: UpsertSeenStateArgs
): Promise<UiSeenStateRecord> {
  const fallback = upsertSeenState(args);
  const profileId = normalizeProfileId(args.profileId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.seenState.upsert({
      where: {
        profileId_eventId: {
          profileId,
          eventId: args.eventId,
        },
      },
      create: {
        profileId,
        eventId: args.eventId,
        seenAtUtc: new Date(fallback.seenAtUtc),
      },
      update: {
        seenAtUtc: new Date(fallback.seenAtUtc),
      },
    });

    return {
      profileId: row.profileId,
      eventId: row.eventId,
      seenAtUtc: formatIsoUtc(row.seenAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SEEN_UPSERT_ERROR]", error);
    return fallback;
  }
}

export async function listPersistedSeenEventIds(
  profileId: string | undefined,
  eventIds: readonly string[]
): Promise<Set<string>> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const fallback = new Set(
    eventIds.filter((eventId) => isSeen(normalizedProfileId, eventId))
  );

  if (eventIds.length === 0) {
    return fallback;
  }

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const rows = await prisma.seenState.findMany({
      where: {
        profileId: normalizedProfileId,
        eventId: { in: [...eventIds] },
      },
      select: { eventId: true },
    });

    return new Set([
      ...fallback,
      ...rows.map((row) => row.eventId),
    ]);
  } catch (error) {
    console.error("[ALERTS_SEEN_LIST_ERROR]", error);
    return fallback;
  }
}

export async function listPersistedActiveMuteStates(
  profileId: string | undefined,
  nowUtc?: string
): Promise<UiMuteStateRecord[]> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const nowIso = nowUtc ?? new Date().toISOString();
  const fallback = listActiveMuteStates(normalizedProfileId, nowIso);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const rows = await prisma.muteState.findMany({
      where: {
        profileId: normalizedProfileId,
        direction: null,
        muteUntilUtc: { gt: new Date(nowIso) },
      },
      orderBy: { muteUntilUtc: "asc" },
    });

    const merged = new Map<string, UiMuteStateRecord>();

    for (const record of fallback) {
      merged.set(`${record.profileId}|${record.symbol}|${record.tf}`, record);
    }

    for (const row of rows) {
      const record: UiMuteStateRecord = {
        profileId: row.profileId,
        symbol: row.symbol,
        tf: row.tf,
        muteUntilUtc: row.muteUntilUtc?.toISOString() ?? nowIso,
      };
      merged.set(`${record.profileId}|${record.symbol}|${record.tf}`, record);
    }

    return [...merged.values()].sort((a, b) => {
      return parseIsoUtcMs(a.muteUntilUtc) - parseIsoUtcMs(b.muteUntilUtc);
    });
  } catch (error) {
    console.error("[ALERTS_MUTE_LIST_ERROR]", error);
    return fallback;
  }
}

export async function upsertPersistedMuteState(
  args: UpsertMuteStateArgs
): Promise<UiMuteStateRecord> {
  const fallback = upsertMuteState(args);
  const profileId = normalizeProfileId(args.profileId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    await prisma.muteState.deleteMany({
      where: {
        profileId,
        symbol: args.symbol,
        tf: args.tf,
        direction: null,
      },
    });

    const row = await prisma.muteState.create({
      data: {
        profileId,
        symbol: args.symbol,
        tf: args.tf,
        direction: null,
        muteUntilUtc: new Date(args.muteUntilUtc),
      },
    });

    return {
      profileId: row.profileId,
      symbol: row.symbol,
      tf: row.tf,
      muteUntilUtc: row.muteUntilUtc
        ? row.muteUntilUtc.toISOString()
        : args.muteUntilUtc,
    };
  } catch (error) {
    console.error("[ALERTS_MUTE_UPSERT_ERROR]", error);
    return fallback;
  }
}

export async function clearPersistedMuteState(
  profileId: string | undefined,
  symbol: string,
  tf: string
): Promise<boolean> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const fallback = clearMuteState(normalizedProfileId, symbol, tf);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const result = await prisma.muteState.deleteMany({
      where: {
        profileId: normalizedProfileId,
        symbol,
        tf,
        direction: null,
      },
    });

    return result.count > 0 || fallback;
  } catch (error) {
    console.error("[ALERTS_MUTE_CLEAR_ERROR]", error);
    return fallback;
  }
}

export async function buildPersistedMutedKeySet(
  profileId: string | undefined,
  nowUtc?: string
): Promise<Set<string>> {
  const items = await listPersistedActiveMuteStates(profileId, nowUtc);
  return new Set(items.map((record) => `${record.symbol}|${record.tf}`));
}

export async function getPersistedSoundPreference(
  profileId?: string
): Promise<GetSoundPreferenceResult> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const fallback = getSoundPreference(normalizedProfileId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.soundPreference.findUnique({
      where: { profileId: normalizedProfileId },
    });

    if (!row) {
      return fallback;
    }

    return {
      profileId: row.profileId,
      enabled: row.enabled,
      updatedAtUtc: formatIsoUtc(row.updatedAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SOUND_PREF_GET_ERROR]", error);
    return fallback;
  }
}

export async function upsertPersistedSoundPreference(
  profileId: string | undefined,
  enabled: boolean,
  updatedAtUtc?: string
): Promise<GetSoundPreferenceResult> {
  const fallback = upsertSoundPreference(profileId, enabled, updatedAtUtc);
  const normalizedProfileId = normalizeProfileId(profileId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.soundPreference.upsert({
      where: { profileId: normalizedProfileId },
      create: {
        profileId: normalizedProfileId,
        enabled,
        updatedAtUtc: new Date(fallback.updatedAtUtc ?? new Date().toISOString()),
      },
      update: {
        enabled,
        updatedAtUtc: new Date(fallback.updatedAtUtc ?? new Date().toISOString()),
      },
    });

    return {
      profileId: row.profileId,
      enabled: row.enabled,
      updatedAtUtc: formatIsoUtc(row.updatedAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SOUND_PREF_UPSERT_ERROR]", error);
    return fallback;
  }
}

export async function getPersistedSoundPlayed(
  profileId: string | undefined,
  eventId: string
): Promise<UiSoundPlayedRecord | null> {
  const normalizedProfileId = normalizeProfileId(profileId);
  const fallback = getSoundPlayed(normalizedProfileId, eventId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.soundPlayed.findUnique({
      where: {
        profileId_eventId: {
          profileId: normalizedProfileId,
          eventId,
        },
      },
    });

    if (!row) {
      return fallback;
    }

    return {
      profileId: row.profileId,
      eventId: row.eventId,
      playedAtUtc: formatIsoUtc(row.playedAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SOUND_PLAYED_GET_ERROR]", error);
    return fallback;
  }
}

export async function markPersistedSoundPlayed(
  profileId: string | undefined,
  eventId: string,
  playedAtUtc?: string
): Promise<UiSoundPlayedRecord> {
  const fallback = markSoundPlayed(profileId, eventId, playedAtUtc);
  const normalizedProfileId = normalizeProfileId(profileId);

  try {
    const prisma = await getAlertsPrisma();
    if (!prisma) {
      return fallback;
    }

    const row = await prisma.soundPlayed.upsert({
      where: {
        profileId_eventId: {
          profileId: normalizedProfileId,
          eventId,
        },
      },
      create: {
        profileId: normalizedProfileId,
        eventId,
        playedAtUtc: new Date(fallback.playedAtUtc),
      },
      update: {
        playedAtUtc: new Date(fallback.playedAtUtc),
      },
    });

    return {
      profileId: row.profileId,
      eventId: row.eventId,
      playedAtUtc: formatIsoUtc(row.playedAtUtc),
    };
  } catch (error) {
    console.error("[ALERTS_SOUND_PLAYED_MARK_ERROR]", error);
    return fallback;
  }
}
