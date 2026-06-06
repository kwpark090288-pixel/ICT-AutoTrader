export const ROUTER_EMIT_POLICIES = [
  "BEST1",
] as const;

export const ROUTER_EVENT_TYPES = [
  "SEND_OPEN",
  "SEND_CLOSE",
] as const;

export const ROUTER_TRADE_DIRS = [
  "LONG",
  "SHORT",
] as const;

export const ROUTER_POLICY_STATES = [
  "NORMAL",
  "CAUTION",
  "TRANSITION",
  "HALT",
] as const;

export const ROUTER_OPEN_INTENT_POI_TIERS = [
  "D1_POI",
  "H4_CORE",
  "H1_SETUP",
  "M30_SETUP",
  "OTHER",
] as const;

export const ROUTER_TFS = [
  "D1",
  "H4",
  "H1",
  "M30",
  "M15",
  "M5",
] as const;