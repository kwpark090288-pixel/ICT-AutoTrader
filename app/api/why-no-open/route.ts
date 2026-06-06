import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  WHY_NO_OPEN_SOURCES,
  type WhyNoOpenExecutionType,
  type WhyNoOpenResponse,
  type WhyNoOpenSourceKey,
  type WhyNoOpenSourceSnapshot,
} from "@/lib/diagnostics/why-no-open";

function parseWindowHours(value: string | null): number {
  if (!value) {
    return 72;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 72;
  }

  return Math.min(parsed, 24 * 14);
}

function isRawExecutionEvent(eventText: string): boolean {
  return (
    eventText.startsWith("[REACTION]") ||
    eventText.startsWith("[ENTRY_WINDOW_OPEN]")
  );
}

function extractExecutionType(
  eventText: string
): WhyNoOpenExecutionType | null {
  if (eventText.startsWith("[REACTION]")) {
    return "REACTION";
  }

  if (eventText.startsWith("[ENTRY_WINDOW_OPEN]")) {
    return "ENTRY_WINDOW_OPEN";
  }

  return null;
}

function extractPoiId(eventText: string): string | null {
  const match = eventText.match(/\bpoi=([^\s]+)/);
  return match?.[1] ?? null;
}

function classifySourceFromPoiId(
  poiId: string
): WhyNoOpenSourceKey | null {
  if (poiId.includes(":CH_POI:")) return "CHANNEL";
  if (poiId.includes(":TL:")) return "TRENDLINE";
  if (
    poiId.includes("POI_FVG") ||
    poiId.includes("CORE_FVG") ||
    poiId.includes("SETUP_FVG") ||
    poiId.includes(":STACK:")
  ) {
    return "FVG";
  }
  if (
    poiId.includes("POI_OB") ||
    poiId.includes("CORE_OB") ||
    poiId.includes("SETUP_OB")
  ) {
    return "OB";
  }

  return null;
}

function classifyLifecycleSource(
  eventText: string
): WhyNoOpenSourceKey | null {
  if (
    eventText.includes(":CH_POI:") ||
    eventText.includes("[CHANNEL]")
  ) {
    return "CHANNEL";
  }

  if (
    eventText.includes(":TL:") ||
    eventText.includes("TL_SUPPORT") ||
    eventText.includes("TL_RESIST") ||
    eventText.includes("[POI_CANDIDATE]")
  ) {
    return "TRENDLINE";
  }

  if (
    eventText.includes("POI_FVG") ||
    eventText.includes("CORE_FVG") ||
    eventText.includes("SETUP_FVG") ||
    eventText.includes("[FVG]") ||
    eventText.includes(":STACK:")
  ) {
    return "FVG";
  }

  if (
    eventText.includes("POI_OB") ||
    eventText.includes("CORE_OB") ||
    eventText.includes("SETUP_OB") ||
    eventText.includes("[OB]")
  ) {
    return "OB";
  }

  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function buildExplanation(args: {
  source: WhyNoOpenSourceKey;
  latestLifecycleText: string | null;
  latestExecutionType: WhyNoOpenExecutionType | null;
  latestPolicyDecision: "ALLOW" | "BLOCK" | null;
  latestPolicyReasons: readonly string[];
  latestPolicyTags: readonly string[];
}): string {
  const {
    source,
    latestLifecycleText,
    latestExecutionType,
    latestPolicyDecision,
    latestPolicyReasons,
    latestPolicyTags,
  } = args;

  if (latestPolicyDecision === "BLOCK") {
    const reasons = latestPolicyReasons.length
      ? latestPolicyReasons.join(", ")
      : "policy_block";
    const tags = latestPolicyTags.length
      ? ` [${latestPolicyTags.join(", ")}]`
      : "";
    return `${source} recent ${latestExecutionType ?? "raw"} blocked by policy: ${reasons}${tags}`;
  }

  if (latestPolicyDecision === "ALLOW") {
    return `${source} recent ${latestExecutionType ?? "raw"} passed policy`;
  }

  if (latestExecutionType) {
    return `${source} emitted ${latestExecutionType}, but no policy row was linked`;
  }

  if (latestLifecycleText) {
    return `${source} lifecycle exists, but no recent execution raw was emitted`;
  }

  return `${source} has no recent lifecycle or execution evidence in this window`;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<WhyNoOpenResponse | { error: string }>> {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const windowHours = parseWindowHours(
    request.nextUrl.searchParams.get("windowHours")
  );
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [signalRows, policyRows] = await Promise.all([
    prisma.signalEvent.findMany({
      where: {
        symbol,
        createdAt: { gte: since },
      },
      select: {
        createdAt: true,
        eventText: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.policyDecisionLog.findMany({
      where: {
        symbol,
        createdAtUtc: { gte: since },
      },
      select: {
        source: true,
        eventType: true,
        decision: true,
        reasonsJson: true,
        policyTagsJson: true,
        createdAtUtc: true,
      },
      orderBy: { createdAtUtc: "desc" },
      take: 200,
    }),
  ]);

  const sources: WhyNoOpenSourceSnapshot[] = WHY_NO_OPEN_SOURCES.map((source) => {
    const lifecycleRow =
      signalRows.find((row) => {
        if (isRawExecutionEvent(row.eventText)) {
          return false;
        }

        return classifyLifecycleSource(row.eventText) === source;
      }) ?? null;

    const executionRow =
      signalRows.find((row) => {
        if (!isRawExecutionEvent(row.eventText)) {
          return false;
        }

        const poiId = extractPoiId(row.eventText);
        if (!poiId) {
          return false;
        }

        return classifySourceFromPoiId(poiId) === source;
      }) ?? null;

    const policyRow =
      policyRows.find((row) => row.source === source) ?? null;

    const latestExecutionType = executionRow
      ? extractExecutionType(executionRow.eventText)
      : null;
    const latestPolicyDecision =
      policyRow && (policyRow.decision === "ALLOW" || policyRow.decision === "BLOCK")
        ? policyRow.decision
        : null;
    const latestPolicyReasons = toStringArray(policyRow?.reasonsJson);
    const latestPolicyTags = toStringArray(policyRow?.policyTagsJson);

    return {
      source,
      latestLifecycleAtUtc: lifecycleRow?.createdAt.toISOString() ?? null,
      latestLifecycleText: lifecycleRow?.eventText ?? null,
      latestExecutionAtUtc: executionRow?.createdAt.toISOString() ?? null,
      latestExecutionText: executionRow?.eventText ?? null,
      latestExecutionType,
      latestPolicyAtUtc: policyRow?.createdAtUtc.toISOString() ?? null,
      latestPolicyDecision,
      latestPolicyReasons,
      latestPolicyTags,
      explanation: buildExplanation({
        source,
        latestLifecycleText: lifecycleRow?.eventText ?? null,
        latestExecutionType,
        latestPolicyDecision,
        latestPolicyReasons,
        latestPolicyTags,
      }),
    };
  });

  return NextResponse.json({
    symbol,
    windowHours,
    generatedAtUtc: new Date().toISOString(),
    sources,
  });
}
