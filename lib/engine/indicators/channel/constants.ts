export const CHANNEL_TFS = ["D1", "H4", "H1", "M30", "M15", "M5"] as const;
export const CHANNEL_MODEL_TFS = ["D1", "H4", "H1", "M30"] as const;
export const CHANNEL_GATE_ONLY_TFS = ["M15", "M5"] as const;

export const CHANNEL_DIRS = ["BULL", "BEAR"] as const;
export const CHANNEL_DIRECTIONS = ["UP", "DOWN"] as const;

export const CHANNEL_TYPES = [
  "D1_CHANNEL",
  "H4_CHANNEL",
  "H1_CHANNEL",
  "M30_CHANNEL",
] as const;

export const CHANNEL_STATES = ["ACTIVE", "INACTIVE", "NONE"] as const;
export const CHANNEL_MODES = ["ENABLED", "CONTEXT_ONLY"] as const;

export const CHANNEL_INVALID_REASONS = [
  "break",
  "anchor_invalid",
  "ttl_expired",
  "parent_poi_ended",
] as const;

export const CHANNEL_POI_STATES = ["ACTIVE", "INACTIVE"] as const;
export const CHANNEL_POI_TRIGGERS = ["sweepRec", "structure", "disp"] as const;

export const CHANNEL_PIVOT_TYPES = ["HIGH", "LOW"] as const;

export const LOOKBACK_BARS = 300;
export const MAX_FORWARD_BARS = 300;
export const MIN_SWING_ATR = 0.25;
export const MIN_RESIDUAL_SAMPLES = 5;
export const DISP_BODY_MAX_ATR = 1.0;
export const DISP_BODY_SUM_ATR = 1.8;

export const BREAK_D1_CLOSES = 2;
export const BREAK_D1_ATR = 0.20;

export const BREAK_H4_CLOSES = 2;
export const BREAK_H4_ATR = 0.20;

export const BREAK_H1_CLOSES = 1;
export const BREAK_H1_ATR = 0.30;

export const BREAK_M30_CLOSES = 1;
export const BREAK_M30_ATR = 0.35;

export const OFFSET_PCTL_D1 = 95;
export const OFFSET_PCTL_H4 = 90;
export const OFFSET_PCTL_H1 = 85;
export const OFFSET_PCTL_M30 = 80;

export const POI_GATE_D1 = 0.15;
export const POI_GATE_H4 = 0.12;
export const POI_GATE_H1 = 0.08;
export const POI_GATE_M30 = 0.06;

export const PARENT_NEAR_ATR = 0.20;
export const PARENT_INSIDE_RATIO = 0.20;

export const POI_CAP_PER_DAY = 2;
export const H1_TTL_BARS = 100;
export const M30_TTL_BARS = 80;
