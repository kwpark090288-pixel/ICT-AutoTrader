import type { Prisma } from "@prisma/client";

import type { StoredSignalPoiHighlight } from "../alerts/types";
import { prisma } from "../db/prisma";
import type { TradePlan } from "./types";

export interface PersistedRuntimeTradeRecord {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight: StoredSignalPoiHighlight | undefined;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseTradePlanJson(value: unknown): TradePlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Partial<TradePlan>;
  if (
    typeof parsed.planId !== "string" ||
    typeof parsed.planKey !== "string" ||
    typeof parsed.symbol !== "string" ||
    typeof parsed.openTime !== "string"
  ) {
    return null;
  }

  if (
    !parsed.invalidationRef ||
    typeof parsed.invalidationRef !== "object" ||
    typeof parsed.invalidationRef.refId !== "string" ||
    typeof parsed.invalidationRef.source !== "string"
  ) {
    const source = parsed.source;
    const poiId = parsed.poiId;

    if (
      typeof source === "string" &&
      typeof poiId === "string" &&
      poiId.length > 0
    ) {
      parsed.invalidationRef =
        source === "CHANNEL"
          ? { source: "CHANNEL_POI", refId: poiId }
          : source === "FVG" || source === "OB" || source === "TRENDLINE"
            ? { source, refId: poiId }
            : undefined;
    }
  }

  if (
    !parsed.invalidationRef ||
    typeof parsed.invalidationRef.refId !== "string" ||
    typeof parsed.invalidationRef.source !== "string"
  ) {
    return null;
  }

  return parsed as TradePlan;
}

function parsePoiHighlightJson(value: unknown): StoredSignalPoiHighlight | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as StoredSignalPoiHighlight;
}

export async function upsertPersistedTradePlanRecord(args: {
  tradeKey: string;
  zoneKey: string;
  plan: TradePlan;
  poiClusterKey: string;
  poiHighlight?: StoredSignalPoiHighlight;
}): Promise<void> {
  const { tradeKey, zoneKey, plan, poiClusterKey, poiHighlight } = args;
  const openedAt = new Date(plan.openTime);
  const closedAt =
    typeof plan.closeTime === "string" && Number.isFinite(Date.parse(plan.closeTime))
      ? new Date(plan.closeTime)
      : null;

  await prisma.tradePlan.upsert({
    where: { planId: plan.planId },
    create: {
      planId: plan.planId,
      planKey: plan.planKey,
      tradeKey,
      zoneKey,
      status: plan.status,
      symbol: plan.symbol,
      tf: plan.tf,
      direction: plan.dir,
      source: plan.source,
      poiTier: plan.poiTier,
      poiId: plan.poiId,
      eventType: plan.eventType,
      riskPctAtOpen: plan.riskPctAtOpen ?? null,
      edgeSigFine: plan.edgeSigFine ?? null,
      edgeSigMid: plan.edgeSigMid ?? null,
      edgeSigCoarse: plan.edgeSigCoarse ?? null,
      rAfterCost: plan.rAfterCost ?? null,
      poiClusterKey,
      poiHighlightJson: poiHighlight ? toJsonValue(poiHighlight) : undefined,
      planJson: toJsonValue(plan),
      openedAt,
      closedAt: closedAt ?? undefined,
    },
    update: {
      planKey: plan.planKey,
      tradeKey,
      zoneKey,
      status: plan.status,
      symbol: plan.symbol,
      tf: plan.tf,
      direction: plan.dir,
      source: plan.source,
      poiTier: plan.poiTier,
      poiId: plan.poiId,
      eventType: plan.eventType,
      riskPctAtOpen: plan.riskPctAtOpen ?? null,
      edgeSigFine: plan.edgeSigFine ?? null,
      edgeSigMid: plan.edgeSigMid ?? null,
      edgeSigCoarse: plan.edgeSigCoarse ?? null,
      rAfterCost: plan.rAfterCost ?? null,
      poiClusterKey,
      poiHighlightJson: poiHighlight ? toJsonValue(poiHighlight) : undefined,
      planJson: toJsonValue(plan),
      openedAt,
      closedAt,
    },
  });
}

export async function listPersistedRuntimeOpenTradeRecords(): Promise<
  PersistedRuntimeTradeRecord[]
> {
  const rows = await prisma.tradePlan.findMany({
    where: {
      status: {
        in: ["OPEN", "CLOSING"],
      },
    },
    orderBy: { openedAt: "asc" },
  });

  const records = rows
    .map((row) => {
      const plan = parseTradePlanJson(row.planJson);
      if (!plan) {
        return null;
      }

      return {
        tradeKey: row.tradeKey,
        zoneKey: row.zoneKey,
        plan,
        poiClusterKey: row.poiClusterKey ?? "",
        poiHighlight: parsePoiHighlightJson(row.poiHighlightJson),
      } satisfies PersistedRuntimeTradeRecord;
    })
    .filter((row): row is PersistedRuntimeTradeRecord => row !== null);

  return records;
}
