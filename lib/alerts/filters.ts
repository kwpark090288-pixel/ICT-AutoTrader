import { getAlertSeverity } from "./sound";
import type {
  AlertEventTypeFilter,
  AlertSeverityFilter,
  OtherInboxFilterState,
  SelectedFeedFilterState,
  StoredSignalEventWithSeen,
} from "./types";

export function getEventTypeBucket(
  event: StoredSignalEventWithSeen
): "OPEN" | "CLOSE" {
  return event.type === "SEND_OPEN" ? "OPEN" : "CLOSE";
}

export function matchesEventTypeFilter(
  event: StoredSignalEventWithSeen,
  filter: AlertEventTypeFilter
): boolean {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "OPEN_ONLY") {
    return event.type === "SEND_OPEN";
  }

  return event.type === "SEND_CLOSE";
}

export function matchesSeverityFilter(
  event: StoredSignalEventWithSeen,
  filter: AlertSeverityFilter
): boolean {
  if (filter === "ALL") {
    return true;
  }

  return getAlertSeverity(event) === filter;
}

export function applySelectedFeedFilters(
  events: readonly StoredSignalEventWithSeen[],
  filterState: SelectedFeedFilterState
): StoredSignalEventWithSeen[] {
  return events.filter((event) => {
    return matchesEventTypeFilter(event, filterState.eventType);
  });
}

export function applyOtherInboxFilters(
  events: readonly StoredSignalEventWithSeen[],
  filterState: OtherInboxFilterState
): StoredSignalEventWithSeen[] {
  return events
    .filter((event) => {
      if (filterState.tab === "Unread") {
        return event.seen === false;
      }

      return true;
    })
    .filter((event) => {
      return matchesEventTypeFilter(event, filterState.eventType);
    })
    .filter((event) => {
      return matchesSeverityFilter(event, filterState.severity);
    });
}
