export const WHY_NO_OPEN_SOURCES = [
  "FVG",
  "OB",
  "CHANNEL",
  "TRENDLINE",
] as const;

export type WhyNoOpenSourceKey = (typeof WHY_NO_OPEN_SOURCES)[number];

export type WhyNoOpenExecutionType = "REACTION" | "ENTRY_WINDOW_OPEN";

export interface WhyNoOpenSourceSnapshot {
  source: WhyNoOpenSourceKey;
  latestLifecycleAtUtc: string | null;
  latestLifecycleText: string | null;
  latestExecutionAtUtc: string | null;
  latestExecutionText: string | null;
  latestExecutionType: WhyNoOpenExecutionType | null;
  latestPolicyAtUtc: string | null;
  latestPolicyDecision: "ALLOW" | "BLOCK" | null;
  latestPolicyReasons: string[];
  latestPolicyTags: string[];
  explanation: string;
}

export interface WhyNoOpenResponse {
  symbol: string;
  windowHours: number;
  generatedAtUtc: string;
  sources: WhyNoOpenSourceSnapshot[];
}
