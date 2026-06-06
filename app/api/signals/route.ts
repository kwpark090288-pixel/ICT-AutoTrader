import { NextRequest, NextResponse } from "next/server";
import {
  applyOtherInboxFilters,
  applySelectedFeedFilters,
} from "../../../lib/alerts/filters";
import {
  buildMutedKeySet,
  computeUnseenHighCountOther,
  computeUnseenHighCountOtherFromSourceWithState,
  groupSignalEvents,
  buildPersistedMutedKeySet,
  listSignalEvents,
  listPersistedSeenEventIds,
  listOtherInboxEvents,
  listSelectedSymbolEvents,
  withSeenProjectionFromSource,
  withSeenProjectionFromSourceWithState,
} from "../../../lib/alerts/store";
import type {
  AlertEventTypeFilter,
  AlertSeenTab,
  AlertSeverityFilter,
  SignalsQueryResult,
} from "../../../lib/alerts/types";
import { listStoredSignalEventsFromDb } from "../../../lib/engine/event-sink";

function parseLimit(value: string | null): number {
  if (!value) {
    return 10;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }

  return parsed;
}

function parseSeenTab(value: string | null): AlertSeenTab {
  return value === "All" ? "All" : "Unread";
}

function parseEventTypeFilter(value: string | null): AlertEventTypeFilter {
  if (value === "OPEN_ONLY" || value === "CLOSE_ONLY") {
    return value;
  }

  return "ALL";
}

function parseSeverityFilter(value: string | null): AlertSeverityFilter {
  if (value === "HIGH" || value === "MID" || value === "LOW") {
    return value;
  }

  return "ALL";
}

function parseGroupFlag(value: string | null): boolean {
  return value === "true";
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<SignalsQueryResult>> {
  const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
  const excludeSymbol =
    request.nextUrl.searchParams.get("excludeSymbol") ?? undefined;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const tab = parseSeenTab(request.nextUrl.searchParams.get("tab"));
  const eventType = parseEventTypeFilter(
    request.nextUrl.searchParams.get("eventType")
  );
  const severity = parseSeverityFilter(
    request.nextUrl.searchParams.get("severity")
  );
  const shouldGroup = parseGroupFlag(request.nextUrl.searchParams.get("group"));
  const planId = request.nextUrl.searchParams.get("planId") ?? undefined;
  const profileId =
    request.nextUrl.searchParams.get("profileId") ?? undefined;
  const nowUtc = new Date().toISOString();
  const memoryMutedKeys = excludeSymbol
    ? buildMutedKeySet(profileId, nowUtc)
    : undefined;
  const dbEvents = await listStoredSignalEventsFromDb({
    symbol,
    excludeSymbol,
    planId,
    take: Math.max(limit * 20, 200),
  });
  const hasDbStructuredEvents = dbEvents.length > 0;
  const persistedMutedKeys =
    excludeSymbol && hasDbStructuredEvents
      ? await buildPersistedMutedKeySet(profileId, nowUtc)
      : undefined;
  const persistedSeenEventIds = hasDbStructuredEvents
    ? await listPersistedSeenEventIds(
        profileId,
        dbEvents.map((event) => event.id)
      )
    : undefined;
  const dbProjectedEvents = hasDbStructuredEvents
    ? withSeenProjectionFromSourceWithState(dbEvents, {
        symbol,
        excludeSymbol,
        tab: "All",
        mutedKeys: persistedMutedKeys,
        seenEventIds: persistedSeenEventIds,
      })
    : undefined;
  const memoryPlanEvents = planId
    ? listSignalEvents().filter((event) => event.planId === planId)
    : undefined;
  const memoryPlanProjectedEvents = planId
    ? withSeenProjectionFromSource(memoryPlanEvents ?? [], {
        profileId,
        tab: "All",
      })
    : undefined;

  const events = planId
    ? applySelectedFeedFilters(
        hasDbStructuredEvents
          ? dbProjectedEvents ?? []
          : memoryPlanProjectedEvents ?? [],
        {
          eventType,
        }
      ).slice(0, limit)
    : hasDbStructuredEvents
      ? symbol
        ? applySelectedFeedFilters(dbProjectedEvents ?? [], {
            eventType,
          }).slice(0, limit)
        : applyOtherInboxFilters(dbProjectedEvents ?? [], {
            tab,
            eventType,
            severity,
          }).slice(0, limit)
      : symbol
        ? listSelectedSymbolEvents({
            profileId,
            symbol,
            limit,
            filterState: {
              eventType,
            },
          })
        : listOtherInboxEvents({
            profileId,
            selectedSymbol: excludeSymbol ?? "",
            limit,
            filterState: {
              tab,
              eventType,
              severity,
            },
            mutedKeys: memoryMutedKeys,
          });

  const result: SignalsQueryResult = {
    events,
  };

  if (!planId && shouldGroup) {
    result.items = groupSignalEvents(events);
  }

  if (!planId && excludeSymbol) {
    result.unseenHighCountOther = hasDbStructuredEvents
      ? computeUnseenHighCountOtherFromSourceWithState(dbEvents, {
          selectedSymbol: excludeSymbol,
          mutedKeys: persistedMutedKeys,
          seenEventIds: persistedSeenEventIds,
        })
      : computeUnseenHighCountOther({
          profileId,
          selectedSymbol: excludeSymbol,
          mutedKeys: memoryMutedKeys,
        });
  }

  return NextResponse.json(result);
}
