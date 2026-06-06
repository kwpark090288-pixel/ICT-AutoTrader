export const DEFAULT_ALERT_PROFILE_ID = "default" as const;

export const ALERT_SEEN_TABS = [
  "Unread",
  "All",
] as const;

export const DEFAULT_MUTE_DURATION_MIN = 60;

export const ALERT_GROUP_WINDOW_MIN = 5;
export const ALERT_GROUP_MIN_COUNT = 3;

export const DEFAULT_SOUND_ALERT_HIGH_ENABLED = false;

export const ALERT_SOUND_EVENT_TYPES = ["SEND_OPEN", "SEND_CLOSE"] as const;

export const DEFAULT_AUTO_TF_SWITCH_ENABLED = true;

export const ALERT_NAV_BARS_AROUND = 60;
export const ALERT_POI_HIGHLIGHT_MS = 10_000;
export const ALERT_PLAN_LINES_HIGHLIGHT_MS = 10_000;
export const ALERT_OPEN_LINK_HIGHLIGHT_MS = 3_000;

export const ALERT_BACKEND_STATES = [
  "LIVE",
  "SYNCING",
  "ERROR",
] as const;

export const ALERT_EVENT_TYPE_FILTERS = [
  "ALL",
  "OPEN_ONLY",
  "CLOSE_ONLY",
] as const;

export const ALERT_SEVERITY_FILTERS = [
  "ALL",
  "HIGH",
  "MID",
  "LOW",
] as const;
