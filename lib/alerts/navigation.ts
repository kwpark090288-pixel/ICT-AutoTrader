import {
  ALERT_NAV_BARS_AROUND,
  ALERT_OPEN_LINK_HIGHLIGHT_MS,
  ALERT_PLAN_LINES_HIGHLIGHT_MS,
  ALERT_POI_HIGHLIGHT_MS,
  DEFAULT_AUTO_TF_SWITCH_ENABLED,
} from "./constants";
import type {
  AlertCardNavigationPlan,
  AlertPanelSource,
  StoredSignalEventWithSeen,
} from "./types";

function parseIsoUtcMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getEventCenterTime(
  event: StoredSignalEventWithSeen
): string {
  if (event.type === "SEND_CLOSE") {
    return event.exitTime ?? event.time;
  }

  return event.time;
}

export function canShowTradePlanLines(
  event: StoredSignalEventWithSeen
): boolean {
  return (
    isFiniteNumber(event.entryRefPrice) &&
    isFiniteNumber(event.stopPrice) &&
    isFiniteNumber(event.tpPrice)
  );
}

type BuildAlertCardNavigationPlanArgs = {
  event: StoredSignalEventWithSeen;
  source: AlertPanelSource;
  currentSymbol: string;
  currentTf: string;
  autoTfSwitch?: boolean;
};

export function buildAlertCardNavigationPlan(
  args: BuildAlertCardNavigationPlanArgs
): AlertCardNavigationPlan {
  const {
    event,
    source,
    currentSymbol,
    currentTf,
    autoTfSwitch = DEFAULT_AUTO_TF_SWITCH_ENABLED,
  } = args;

  const steps: AlertCardNavigationPlan["steps"] = [];
  const centerTime = getEventCenterTime(event);

  if (source === "SELECTED_SYMBOL_FEED") {
    steps.push({
      type: "whenReady",
      symbol: currentSymbol,
      tf: currentTf,
    });
    steps.push({
      type: "goToTime",
      centerTime,
      barsAround: ALERT_NAV_BARS_AROUND,
    });
  } else {
    const targetTf = autoTfSwitch ? event.tf : currentTf;

    steps.push({
      type: "setSelectedSymbol",
      symbol: event.symbol,
    });

    if (autoTfSwitch) {
      steps.push({
        type: "setSelectedTf",
        tf: event.tf,
      });
    }

    steps.push({
      type: "whenReady",
      symbol: event.symbol,
      tf: targetTf,
    });
    steps.push({
      type: "goToTime",
      centerTime,
      barsAround: ALERT_NAV_BARS_AROUND,
    });
  }

  if (typeof event.poiRef === "string" && event.poiRef.length > 0) {
    steps.push({
      type: "highlightPOI",
      poiRef: event.poiRef,
      durationMs: ALERT_POI_HIGHLIGHT_MS,
    });
  }

  if (canShowTradePlanLines(event)) {
    steps.push({
      type: "showTradePlanLines",
      entryRefPrice: event.entryRefPrice as number,
      stopPrice: event.stopPrice as number,
      tpPrice: event.tpPrice as number,
      durationMs: ALERT_PLAN_LINES_HIGHLIGHT_MS,
    });
  }

  steps.push({
    type: "markSeen",
    eventId: event.id,
  });

  return {
    source,
    steps,
  };
}

export function findLinkedOpenEvent(
  events: readonly StoredSignalEventWithSeen[],
  planId: string
): StoredSignalEventWithSeen | null {
  const matches = events
    .filter((event) => {
      return event.planId === planId && event.type === "SEND_OPEN";
    })
    .sort((a, b) => {
      const timeDiff = parseIsoUtcMs(a.time) - parseIsoUtcMs(b.time);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return a.id.localeCompare(b.id);
    });

  return matches[0] ?? null;
}

export function buildOpenLinkPlan(
  events: readonly StoredSignalEventWithSeen[],
  planId: string
): AlertCardNavigationPlan | null {
  const openEvent = findLinkedOpenEvent(events, planId);
  if (!openEvent) {
    return null;
  }

  return {
    source: "OPEN_LINK",
    steps: [
      {
        type: "scrollToEvent",
        eventId: openEvent.id,
      },
      {
        type: "highlightEvent",
        eventId: openEvent.id,
        durationMs: ALERT_OPEN_LINK_HIGHLIGHT_MS,
      },
    ],
  };
}
