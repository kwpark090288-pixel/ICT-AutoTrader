import type {
  PolicyDecision,
  PolicyEventType,
  PolicyResult,
  PolicySource,
  SignalCandidate,
} from "../policy/types";
import {
  ROUTER_EMIT_POLICIES,
  ROUTER_EVENT_TYPES,
  ROUTER_OPEN_INTENT_POI_TIERS,
  ROUTER_POLICY_STATES,
  ROUTER_TFS,
  ROUTER_TRADE_DIRS,
} from "./constants";

export type RouterEmitPolicy = (typeof ROUTER_EMIT_POLICIES)[number];
export type RouterEventType = (typeof ROUTER_EVENT_TYPES)[number];
export type RouterTradeDir = (typeof ROUTER_TRADE_DIRS)[number];
export type RouterPolicyState = (typeof ROUTER_POLICY_STATES)[number];
export type RouterOpenIntentPoiTier =
  (typeof ROUTER_OPEN_INTENT_POI_TIERS)[number];
export type RouterTf = (typeof ROUTER_TFS)[number];

export type RouterCollabStrength = "NONE" | "WEAK" | "OK" | "STRONG";

export interface RouterPolicySnapshot {
  decision: PolicyDecision;
  regimeState: RouterPolicyState;
  c_bps?: number;
  sc?: number;
}

export interface RouterCandidate {
  signal: SignalCandidate;
  tf: RouterTf;
  policy: PolicyResult;

  priceExtreme: number;
  poiConfTime: string;

  score?: number;
  collabStrength?: RouterCollabStrength;
  entryFillPrice?: number;
  poiZoneBottom?: number;
  poiZoneTop?: number;
}

export interface RouterOpenIntent {
  symbol: string;
  dir: RouterTradeDir;
  eventType: PolicyEventType;
  openTime: string;
  source: PolicySource;
  poiTier: RouterOpenIntentPoiTier;
  poiId: string;
  tf: RouterTf;

  entryBoundaryPrice: number;
  hardInvalidationPrice: number;
  tags: string[];

  policySnapshot: RouterPolicySnapshot;

  score?: number;
  collabStrength?: RouterCollabStrength;
  entryFillPrice?: number;
  riskPctAtOpen?: number;
  poiClusterKey?: string;
  edgeSigFine?: string;
  edgeSigMid?: string;
  edgeSigCoarse?: string;

  poiZoneBottom?: number;
  poiZoneTop?: number;
}

export interface RouterPlanRef {
  planKey: string;
  planId: string;
}

export interface RouterSendOpenPayload extends RouterPlanRef {
  type: "SEND_OPEN";
  intent: RouterOpenIntent;
}

export interface RouterSendClosePayload {
  id: string;
  type: "SEND_CLOSE";
  symbol: string;
  tf: RouterTf;
  time: string;
  direction: RouterTradeDir;
  planId: string;
  exitTime: string;
  outcome: "HARD_TP" | "HARD_SL" | "SOFT_INVALID" | "TIMEOUT";
  exitPrice: number;
  rGross: number;

  mfeR?: number;
  maeR?: number;
  bothHit?: boolean;
  weaknessCodes?: string[];
  replayNote?: string;

  policyState?: RouterPolicyState;
  entryQuality?: "IDEAL" | "VALID" | "LATE";
  collabStrength?: RouterCollabStrength;
  score?: number;
  severity?: "HIGH" | "MID" | "LOW";
  poiRef?: string;
}

export type RouterEvent = RouterSendOpenPayload | RouterSendClosePayload;
