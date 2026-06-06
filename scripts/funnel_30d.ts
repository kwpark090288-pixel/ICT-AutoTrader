import "dotenv/config";

import { prisma } from "../lib/db/prisma";

type SourceKey = "FVG" | "OB" | "CHANNEL" | "TRENDLINE" | "UNKNOWN";

type SourceStats = {
  rawReaction: number;
  rawEntry: number;
  rawExecTotal: number;
  policyAllow: number;
  policyBlock: number;
  policyTotal: number;
  opened: number;
  currentlyOpen: number;
  closed: number;
  wins: number;
  losses: number;
  flat: number;
  hardTp: number;
  hardSl: number;
  timeout: number;
  softInvalid: number;
  otherOutcome: number;
  sumRAfterCost: number;
  closedWithR: number;
};

const STRUCTURED_SIGNAL_EVENT_PREFIX = "[STORED_SIGNAL_EVENT] ";

function createEmptyStats(): SourceStats {
  return {
    rawReaction: 0,
    rawEntry: 0,
    rawExecTotal: 0,
    policyAllow: 0,
    policyBlock: 0,
    policyTotal: 0,
    opened: 0,
    currentlyOpen: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    flat: 0,
    hardTp: 0,
    hardSl: 0,
    timeout: 0,
    softInvalid: 0,
    otherOutcome: 0,
    sumRAfterCost: 0,
    closedWithR: 0,
  };
}

function classifySourceFromPoiId(poiId: string): SourceKey {
  if (poiId.includes(":CH_POI:")) return "CHANNEL";
  if (poiId.includes(":TL:")) return "TRENDLINE";
  if (poiId.includes("POI_FVG") || poiId.includes("CORE_FVG") || poiId.includes("SETUP_FVG") || poiId.includes(":STACK:")) {
    return "FVG";
  }
  if (poiId.includes("POI_OB") || poiId.includes("CORE_OB") || poiId.includes("SETUP_OB")) {
    return "OB";
  }
  return "UNKNOWN";
}

function normalizePlanSource(source: unknown): SourceKey {
  if (source === "FVG" || source === "OB" || source === "CHANNEL" || source === "TRENDLINE") {
    return source;
  }
  return "UNKNOWN";
}

function getStatBucket(map: Map<SourceKey, SourceStats>, source: SourceKey): SourceStats {
  const existing = map.get(source);
  if (existing) {
    return existing;
  }

  const created = createEmptyStats();
  map.set(source, created);
  return created;
}

function extractPoiId(eventText: string): string | null {
  const match = eventText.match(/\bpoi=([^\s]+)/);
  return match?.[1] ?? null;
}

function toIso(value: Date): string {
  return value.toISOString();
}

async function main() {
  const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
  const days = Math.max(1, Number(daysArg?.split("=")[1] ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const statsBySource = new Map<SourceKey, SourceStats>();

  const signalRows = await prisma.signalEvent.findMany({
    where: {
      createdAt: { gte: since },
    },
    select: {
      createdAt: true,
      eventText: true,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const row of signalRows) {
    const eventText = row.eventText;
    if (eventText.startsWith(STRUCTURED_SIGNAL_EVENT_PREFIX)) {
      continue;
    }

    const isReaction = eventText.startsWith("[REACTION]");
    const isEntry = eventText.startsWith("[ENTRY_WINDOW_OPEN]");
    if (!isReaction && !isEntry) {
      continue;
    }

    const poiId = extractPoiId(eventText);
    const source = poiId ? classifySourceFromPoiId(poiId) : "UNKNOWN";
    const bucket = getStatBucket(statsBySource, source);

    if (isReaction) {
      bucket.rawReaction += 1;
      bucket.rawExecTotal += 1;
    }

    if (isEntry) {
      bucket.rawEntry += 1;
      bucket.rawExecTotal += 1;
    }
  }

  const policyRows = await prisma.policyDecisionLog.findMany({
    where: {
      openTimeUtc: { gte: since },
    },
    select: {
      source: true,
      decision: true,
    },
    orderBy: { openTimeUtc: "asc" },
  });

  for (const row of policyRows) {
    const source = normalizePlanSource(row.source);
    const bucket = getStatBucket(statsBySource, source);
    bucket.policyTotal += 1;

    if (row.decision === "ALLOW") {
      bucket.policyAllow += 1;
    } else if (row.decision === "BLOCK") {
      bucket.policyBlock += 1;
    }
  }

  const tradeRows = await prisma.tradePlan.findMany({
    where: {
      OR: [
        { openedAt: { gte: since } },
        { closedAt: { gte: since } },
        { status: { in: ["OPEN", "CLOSING"] } },
      ],
    },
    select: {
      source: true,
      status: true,
      openedAt: true,
      closedAt: true,
      rAfterCost: true,
      planJson: true,
    },
    orderBy: { openedAt: "asc" },
  });

  for (const row of tradeRows) {
    const source = normalizePlanSource(row.source);
    const bucket = getStatBucket(statsBySource, source);

    if (row.openedAt >= since) {
      bucket.opened += 1;
    }

    if (row.status === "OPEN" || row.status === "CLOSING") {
      bucket.currentlyOpen += 1;
    }

    if (row.closedAt && row.closedAt >= since) {
      bucket.closed += 1;

      const planJson = row.planJson as { outcome?: string } | null;
      const outcome = planJson?.outcome ?? null;

      if (typeof row.rAfterCost === "number" && Number.isFinite(row.rAfterCost)) {
        bucket.sumRAfterCost += row.rAfterCost;
        bucket.closedWithR += 1;

        if (row.rAfterCost > 0.05) {
          bucket.wins += 1;
        } else if (row.rAfterCost < -0.05) {
          bucket.losses += 1;
        } else {
          bucket.flat += 1;
        }
      }

      if (outcome === "HARD_TP") bucket.hardTp += 1;
      else if (outcome === "HARD_SL") bucket.hardSl += 1;
      else if (outcome === "TIMEOUT") bucket.timeout += 1;
      else if (outcome === "SOFT_INVALID") bucket.softInvalid += 1;
      else bucket.otherOutcome += 1;
    }
  }

  const orderedSources: SourceKey[] = ["FVG", "OB", "CHANNEL", "TRENDLINE", "UNKNOWN"];
  const table = orderedSources
    .map((source) => {
      const s = getStatBucket(statsBySource, source);
      return {
        source,
        raw_exec: s.rawExecTotal,
        reaction: s.rawReaction,
        entry: s.rawEntry,
        policy_total: s.policyTotal,
        policy_allow: s.policyAllow,
        policy_block: s.policyBlock,
        opened: s.opened,
        current_open: s.currentlyOpen,
        closed: s.closed,
        wins: s.wins,
        losses: s.losses,
        flat: s.flat,
        avg_r_after_cost: s.closedWithR > 0 ? Number((s.sumRAfterCost / s.closedWithR).toFixed(3)) : null,
        hard_tp: s.hardTp,
        hard_sl: s.hardSl,
        timeout: s.timeout,
        soft_invalid: s.softInvalid,
        other_outcome: s.otherOutcome,
      };
    });

  console.log(`30d funnel window: ${toIso(since)} -> ${toIso(new Date())}`);
  console.log("raw_exec = [REACTION] + [ENTRY_WINDOW_OPEN] from signals table, classified by poi id");
  console.log("policy_total / policy_allow / policy_block = policy_decision_log DB (available from logging activation onward)");
  console.log("opened/closed/current_open = trade_plans DB");
  if (policyRows.length === 0) {
    console.log("policy_decision_log rows in window: 0 (future worker evaluations will populate this)");
  }
  console.table(table);

  const totals = table.reduce(
    (acc, row) => {
      acc.raw_exec += row.raw_exec;
      acc.reaction += row.reaction;
      acc.entry += row.entry;
      acc.policy_total += row.policy_total;
      acc.policy_allow += row.policy_allow;
      acc.policy_block += row.policy_block;
      acc.opened += row.opened;
      acc.current_open += row.current_open;
      acc.closed += row.closed;
      return acc;
    },
    {
      raw_exec: 0,
      reaction: 0,
      entry: 0,
      policy_total: 0,
      policy_allow: 0,
      policy_block: 0,
      opened: 0,
      current_open: 0,
      closed: 0,
    }
  );

  console.log("totals:", JSON.stringify(totals));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[FUNNEL_30D_ERROR]", error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exit(1);
});
