// lib/engine/constants.ts
export const MAX_FORWARD_BARS = 300;
export const MIN_ZONE_HEIGHT_ATR = 0.15;

// Touch penetration filters
export const PENETRATION_ATR = 0.10;   // TF_ATR * 0.10
export const PENETRATION_ZONE = 0.25;  // zoneHeight * 0.25

// Overlap ratios (NOT ATR ratio; overlap ratio)
export const INSIDE_OVERLAP_RATIO = 0.20;
export const STACK_OVERLAP_RATIO = 0.30;

// LTF gate
export const LTF_GATE_ATR = 0.20;

// Reaction cooldown (minutes)
export const COOLDOWN_AFTER_15M_REACTION_MIN = 30;
export const COOLDOWN_AFTER_5M_ENTRY_MIN = 60;

// Active limits
export const MAX_ACTIVE_D1 = 3;
export const MAX_ACTIVE_H4 = 10;
export const MAX_ACTIVE_H1_SETUP = 6;
export const MAX_ACTIVE_M30_SETUP = 6;

