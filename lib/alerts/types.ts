import {
  ALERT_BACKEND_STATES,
  ALERT_EVENT_TYPE_FILTERS,
  ALERT_SEEN_TABS,
  ALERT_SEVERITY_FILTERS,
} from "./constants";

export interface StoredSignalEvent {
  id: string;
  type: "SEND_OPEN" | "SEND_CLOSE";
  symbol: string;
  tf: string;
  time: string;
  exitTime?: string;
  direction: "LONG" | "SHORT";
  planId?: string;
  poiRef?: string;

  entryRefPrice?: number;
  stopPrice?: number;
  tpPrice?: number;
  rrChosen?: number;
  tpMode?: string;
  entryQuality?: string;
  poiTier?: string;
  collabStrength?: string;
  policyState?: string;
  score?: number;
  severity?: "HIGH" | "MID" | "LOW";

  outcome?: "HARD_TP" | "HARD_SL" | "SOFT_INVALID" | "TIMEOUT";
  exitPrice?: number;
  rGross?: number;
  mfeR?: number;
  maeR?: number;
  bothHit?: boolean;
  weaknessCodes?: string[];
  replayNote?: string;
  poiHighlight?: StoredSignalPoiHighlight;
}

export type StoredSignalPoiLine = {
  t1: number;
  p1: number;
  t2: number;
  p2: number;
};

export type StoredSignalPoiHighlight =
  | {
      kind: "TRENDLINE";
      poiRef: string;
      tf: string;
      line: StoredSignalPoiLine;
    }
  | {
      kind: "CHANNEL";
      poiRef: string;
      tf: string;
      mode: "up" | "down";
      base: StoredSignalPoiLine;
      offset: number;
    };

export interface ReviewNoteRecord {
  planId: string;
  reviewNoteText: string;
  reviewNoteUpdatedAtUtc: string;
}

export type AlertSeenTab = (typeof ALERT_SEEN_TABS)[number];
export type AlertBackendState = (typeof ALERT_BACKEND_STATES)[number];
export type AlertEventTypeFilter = (typeof ALERT_EVENT_TYPE_FILTERS)[number];
export type AlertSeverityFilter = (typeof ALERT_SEVERITY_FILTERS)[number];

export interface SelectedFeedFilterState {
  eventType: AlertEventTypeFilter;
}

export interface OtherInboxFilterState {
  tab: AlertSeenTab;
  eventType: AlertEventTypeFilter;
  severity: AlertSeverityFilter;
}

export interface UiSeenStateRecord {
  profileId: string;
  eventId: string;
  seenAtUtc: string;
}

export interface UiMuteStateRecord {
  profileId: string;
  symbol: string;
  tf: string;
  muteUntilUtc: string;
}

export interface UiSoundPreferenceRecord {
  profileId: string;
  enabled: boolean;
  updatedAtUtc: string;
}

export interface UiSoundPlayedRecord {
  profileId: string;
  eventId: string;
  playedAtUtc: string;
}

export interface SoundPlayEvalResult {
  shouldPlay: boolean;
  reason:
    | "OK"
    | "SOUND_OFF"
    | "NOT_OTHER_SYMBOL"
    | "NOT_HIGH"
    | "MUTED"
    | "ALREADY_PLAYED";
}

export type AlertPanelSource =
  | "SELECTED_SYMBOL_FEED"
  | "OTHER_SYMBOLS_INBOX"
  | "OPEN_LINK";

export type AlertNavigationStep =
  | { type: "setSelectedSymbol"; symbol: string }
  | { type: "setSelectedTf"; tf: string }
  | { type: "whenReady"; symbol: string; tf: string }
  | { type: "goToTime"; centerTime: string; barsAround: number }
  | { type: "highlightPOI"; poiRef: string; durationMs: number }
  | {
      type: "showTradePlanLines";
      entryRefPrice: number;
      stopPrice: number;
      tpPrice: number;
      durationMs: number;
    }
  | { type: "markSeen"; eventId: string }
  | { type: "scrollToEvent"; eventId: string }
  | { type: "highlightEvent"; eventId: string; durationMs: number };

export interface AlertCardNavigationPlan {
  source: AlertPanelSource;
  steps: AlertNavigationStep[];
}

export type AlertTrafficLightState = "STRONG" | "CAUTION" | "SKIP";

export interface SelectedFeedOpenCard {
  kind: "OPEN";
  id: string;
  symbol: string;
  tf: string;
  time: string;
  direction: "LONG" | "SHORT";

  entryRefPrice: number;
  stopPrice: number;
  tpPrice: number;
  rrChosen: number;

  policyState?: string;
  trafficLight: AlertTrafficLightState;

  tpMode?: string;
  entryQuality?: string;
  poiTier?: string;
  collabStrength?: string;
  score?: number;
  severity?: "HIGH" | "MID" | "LOW";
}

export interface SelectedFeedCloseCard {
  kind: "CLOSE";
  id: string;
  symbol: string;
  tf: string;
  time: string;
  direction: "LONG" | "SHORT";

  outcome: "HARD_TP" | "HARD_SL" | "SOFT_INVALID" | "TIMEOUT";
  exitPrice: number;
  rGross: number;

  mfeR?: number;
  maeR?: number;
  bothHit?: boolean;
  weaknessPreview: string[];
  weaknessMoreCount: number;
  replayNote?: string;
  hasReviewNoteBadge: boolean;
  openLinkPlanId?: string;

  score?: number;
  severity?: "HIGH" | "MID" | "LOW";
}

export type SelectedFeedCard = SelectedFeedOpenCard | SelectedFeedCloseCard;

export interface StoredSignalEventWithSeen extends StoredSignalEvent {
  seen: boolean;
}

export interface SignalGroupSummary {
  groupKey: string;
  symbol: string;
  tf: string;
  eventType: "SEND_OPEN" | "SEND_CLOSE";
  direction: "LONG" | "SHORT";
  count: number;
  latestTime: string;
  earliestTime: string;
  severity: "HIGH" | "MID" | "LOW";
  eventIds: string[];
  seen: boolean;
  unseenCount: number;
}

export type SignalFeedItem =
  | { kind: "event"; event: StoredSignalEventWithSeen }
  | { kind: "group"; group: SignalGroupSummary };

export interface SignalsQueryResult {
  events: StoredSignalEventWithSeen[];
  items?: SignalFeedItem[];
  unseenHighCountOther?: number;
}

export interface MuteQueryResult {
  items: UiMuteStateRecord[];
}

export interface WatchlistStatusItem {
  symbol: string;
  state: AlertBackendState;
  lastBarCloseTimeUtc?: string;
}

export interface SelectedFeedStatusView {
  state: "READY" | "EMPTY" | "SYNCING" | "ERROR";
  message: string | null;
  showRetry: boolean;
  lastUpdateTime: string | null;
}

export interface OtherInboxStatusView {
  state: "READY" | "EMPTY" | "ERROR";
  message: string | null;
  showRetry: boolean;
  lastUpdateTime: string | null;
  watchlistLine: string;
}
