export const TRENDLINE_TFS = [
  "D1",
  "H4",
  "H1",
  "M30",
  "M15",
  "M5",
] as const;

export const TRENDLINE_MODEL_TFS = [
  "D1",
  "H4",
  "H1",
  "M30",
] as const;

export const TRENDLINE_REACTION_TFS = ["M15", "M5"] as const;

export const TRENDLINE_TYPES = [
  "TL_SUPPORT",
  "TL_RESIST",
] as const;

export const LINE_STATES = [
  "ACTIVE",
  "INACTIVE",
  "DELETED",
] as const;

export const TRENDLINE_INVALID_REASONS = [
  "break_confirmed",
  "stale_expired",
  "pruned_by_limit",
] as const;

export const TRENDLINE_PIVOT_TYPES = ["HIGH", "LOW"] as const;
export const TRENDLINE_STRUCTURE_STATES = ["UP", "DOWN", "MIXED"] as const;

export const TRENDLINE_BEST_MATCH_KINDS = [
  "OB",
  "FVG",
  "CHANNEL",
  "NONE",
] as const;

export const TRENDLINE_POI_CANDIDATE_REASONS = [
  "roleFlip",
  "collab",
] as const;

export const TRENDLINE_PIVOT_LEN = 3;

export const TRENDLINE_LTF_TRIGGER_TOKENS = [
  "CHOCH",
  "MR_MICRO_FVG",
  "MR_MICRO_OB",
  "SWEEP_REC",
] as const;

export const TRENDLINE_LTF_MICRO_RETEST_TYPES = [
  "MR_MICRO_FVG",
  "MR_MICRO_OB",
] as const;

export const TRENDLINE_LTF_MICRO_PIVOT_LEN = 2;
export const TRENDLINE_LTF_SWEEP_RECOVERY_MAX_BARS = 2;
export const TRENDLINE_MICRO_OB_LOOKBACK_BARS = 6;
export const TRENDLINE_MICRO_FVG_MIN_ZONE_HEIGHT_ATR = 0.15;
export const TRENDLINE_LTF_GATE_ATR = 0.2;

export const LOOKBACK_D1 = 300;
export const LOOKBACK_H4 = 400;
export const LOOKBACK_H1 = 300;
export const LOOKBACK_M30 = 200;

export const MIN_SWING_ATR_D1 = 0.5;
export const MIN_SWING_ATR_H4 = 0.4;
export const MIN_SWING_ATR_H1 = 0.3;
export const MIN_SWING_ATR_M30 = 0.25;

export const MIXED_SWING_MULT = 1.4;
export const MIXED_RISK_TAG = "TL_MIXED_RISK";
export const MIXED_BREAK_COUNT = 1;

export const MAX_FORWARD_BARS_D1 = 300;
export const MAX_FORWARD_BARS_H4 = 250;
export const MAX_FORWARD_BARS_H1 = 150;
export const MAX_FORWARD_BARS_M30 = 100;

export const BREAK_CLOSES_D1 = 2;
export const BREAK_CLOSES_H4 = 2;
export const BREAK_CLOSES_H1 = 1;
export const BREAK_CLOSES_M30 = 1;

export const BREAK_MARGIN_ATR_D1 = 0.2;
export const BREAK_MARGIN_ATR_H4 = 0.2;
export const BREAK_MARGIN_ATR_H1 = 0.25;
export const BREAK_MARGIN_ATR_M30 = 0.3;

export const ROLE_FLIP_TOUCH_MARGIN_ATR = 0.15;
export const ROLE_FLIP_CONFIRM_WINDOW_BARS = 2;
export const ROLE_FLIP_TAG = "TL_ROLE_FLIP";

export const CONTEXT_OK_ATR_D1 = 0.3;
export const CONTEXT_TIGHT_ATR_D1 = 0.12;
export const CONTEXT_OK_ATR_H4 = 0.25;
export const CONTEXT_TIGHT_ATR_H4 = 0.1;
export const CONTEXT_OK_ATR_H1 = 0.2;
export const CONTEXT_TIGHT_ATR_H1 = 0.08;
export const CONTEXT_OK_ATR_M30 = 0.15;
export const CONTEXT_TIGHT_ATR_M30 = 0.06;

export const TL_COLLAB_POI_OK = "TL_COLLAB_POI_OK";
export const TL_COLLAB_POI_TIGHT = "TL_COLLAB_POI_TIGHT";
export const TL_COLLAB_CHANNEL_TIGHT = "TL_COLLAB_CHANNEL_TIGHT";

export const DAILY_CAP_H1_POI = 2;
export const DAILY_CAP_M30_POI = 2;
