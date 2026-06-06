export const TRADE_PLAN_STATUSES = [
  "OPEN",
  "CLOSING",
  "CLOSED",
] as const;

export const TRADE_MONITOR_TF = "M5" as const;

export const TRADE_TP_MODES = [
  "LIQ",
  "RR",
] as const;

export const TRADE_CLOSE_OUTCOMES = [
  "HARD_TP",
  "HARD_SL",
  "SOFT_INVALID",
  "TIMEOUT",
] as const;

export const TRADE_TIMEOUT_SIGNS = [
  "PROFIT",
  "LOSS",
  "FLAT",
  "na",
] as const;

export const TRADE_STRENGTH_CODES = [
  "S_POI_TIER_HIGH",
  "S_COLLAB_STRONG",
  "S_ENTRY_IDEAL",
  "S_TP_MODE_LIQ",
  "S_SCORE_HIGH",
  "S_POLICY_OK",
] as const;

export const TRADE_WEAKNESS_CODES = [
  "W_POLICY_CAUTION",
  "W_ENTRY_LATE",
  "W_TP_MODE_RR",
  "W_RR_LOW",
  "W_SC_LOW",
  "W_BOTH_HIT",
  "W_GAVE_BACK_PROFIT",
] as const;

export const TRADE_ENTRY_QUALITIES = [
  "IDEAL",
  "VALID",
  "LATE",
] as const;

export const TRADE_SUPPRESS_REASONS = [
  "DUPLICATE",
  "POLICY_MISSING",
  "HALT_OR_BLOCK",
  "LATE_LOW_CONV",
  "INVALID_INPUT",
  "DATA_GAP",
  "DEDUP_ZONE",
] as const;

export const STOP_BUFFER_ATR = 0.15;
export const STOP_BUFFER_MIN_TICKS = 2;

export const ENTRY_Q_IDEAL_ATR = 0.05;
export const ENTRY_Q_VALID_ATR = 0.10;

export const RR_MIN = 1.20;
export const RR_MAX_DEFAULT = 3.00;
export const RR_MAX_H4_CORE = 3.50;
export const RR_MAX_D1_POI = 4.00;
export const RR_MAX_D1_POI_STRONG = 4.50;

export const RR_BASE_IDEAL = 1.80;
export const RR_BASE_VALID = 1.50;
export const RR_BASE_LATE = 1.30;

export const EQ_BAND_ATR = 0.10;

export const H1_TP_LOOKBACK_BARS = 300;
export const M30_TP_LOOKBACK_BARS = 500;

export const TIMEOUT_D1_POI_MIN = 360;
export const TIMEOUT_H4_CORE_MIN = 240;
export const TIMEOUT_H1_SETUP_MIN = 120;
export const TIMEOUT_M30_SETUP_MIN = 90;
export const TIMEOUT_OTHER_MIN = 120;

export const M5_INTERVAL_MS = 5 * 60 * 1000;
export const TRADE_TICK_EPSILON_FACTOR = 1e-6;
