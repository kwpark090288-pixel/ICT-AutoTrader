import { WINDOW_CONC_15M_MIN, WINDOW_PNL_ROLLING_HOURS } from "./constants";
import { prisma } from "../db/prisma";
import {
  buildRuntimeAlertOnlyAccountSnapshotFromState,
} from "./runtime-input";
import {
  reevaluateRiskMode,
  shouldEnterRiskHalt,
  shouldStayRiskHalt,
} from "./gates/risk";
import type {
  AccountSnapshot,
  ConcentrationHistoryItem,
  EdgeSignatureKeys,
  EdgeSignatureStats,
  PolicyResult,
  PolicyRiskMode,
  SignalCandidate,
} from "./types";
import type { TradePlan } from "../tradelifecycle/types";

const DEFAULT_POLICY_PROFILE_ID = "default";
const DEFAULT_POLICY_SCOPE = "GLOBAL";

type AccountRiskMetrics = {
  realizedPnl24hPct: number;
  consecutiveLosses: number;
  lastWinRAfterCost: number | null;
  last2WinsRAfterCostSum: number | null;
  openRiskPct: number;
};

export interface RuntimePolicyDbState {
  account: AccountSnapshot;
  recentConcentrationHistory15m: ConcentrationHistoryItem[];
  fineStats: EdgeSignatureStats | null;
  midStats: EdgeSignatureStats | null;
  coarseStats: EdgeSignatureStats | null;
  lastWinRAfterCost: number | null;
  last2WinsRAfterCostSum: number | null;
  storedRiskMode: PolicyRiskMode;
}

function parseIsoDate(value: string): Date | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampPolicyRiskMode(value: string | null | undefined): PolicyRiskMode {
  return value === "NORMAL" || value === "L1" || value === "L2" || value === "HALT"
    ? value
    : "NORMAL";
}

function classifyClosedTradeR(rAfterCost: number): "LOSS" | "WIN" | "FLAT" {
  if (rAfterCost < -0.05) {
    return "LOSS";
  }

  if (rAfterCost > 0.05) {
    return "WIN";
  }

  return "FLAT";
}

function computeConsecutiveLosses(
  rows: readonly { rAfterCost: number | null }[]
): number {
  let losses = 0;

  for (const row of rows) {
    if (!isFiniteNumber(row.rAfterCost)) {
      continue;
    }

    const classification = classifyClosedTradeR(row.rAfterCost);
    if (classification === "WIN") {
      break;
    }

    if (classification === "LOSS") {
      losses += 1;
    }
  }

  return losses;
}

function computeWinRecoveryStats(
  rows: readonly { rAfterCost: number | null }[]
): {
  lastWinRAfterCost: number | null;
  last2WinsRAfterCostSum: number | null;
} {
  const wins = rows
    .map((row) => row.rAfterCost)
    .filter((value): value is number => isFiniteNumber(value))
    .filter((value) => classifyClosedTradeR(value) === "WIN")
    .slice(0, 2);

  return {
    lastWinRAfterCost: wins.length > 0 ? wins[0] : null,
    last2WinsRAfterCostSum:
      wins.length > 0 ? wins.reduce((sum, value) => sum + value, 0) : null,
  };
}

function computeRealizedPnl24hPct(
  rows: readonly { riskPctAtOpen: number | null; rAfterCost: number | null }[]
): number {
  return rows.reduce((sum, row) => {
    if (!isFiniteNumber(row.riskPctAtOpen) || !isFiniteNumber(row.rAfterCost)) {
      return sum;
    }

    return sum + row.riskPctAtOpen * row.rAfterCost;
  }, 0);
}

function computeNextPolicyRiskMode(args: {
  prevRiskMode: PolicyRiskMode;
  metrics: AccountRiskMetrics;
}): PolicyRiskMode {
  const { prevRiskMode, metrics } = args;

  if (shouldEnterRiskHalt(prevRiskMode, metrics.realizedPnl24hPct)) {
    return "HALT";
  }

  if (shouldStayRiskHalt(prevRiskMode, metrics.realizedPnl24hPct)) {
    return "HALT";
  }

  return reevaluateRiskMode({
    prevRiskMode,
    consecutiveLosses: metrics.consecutiveLosses,
    lastWinRAfterCost: metrics.lastWinRAfterCost,
    last2WinsRAfterCostSum: metrics.last2WinsRAfterCostSum,
  });
}

async function loadAccountRiskMetrics(openTime: Date): Promise<AccountRiskMetrics> {
  const pnlWindowStart = new Date(
    openTime.getTime() - WINDOW_PNL_ROLLING_HOURS * 60 * 60 * 1000
  );

  const [recentClosedRows, closedHistoryRows, openRiskAggregate] = await Promise.all([
    prisma.tradePlan.findMany({
      where: {
        status: "CLOSED",
        closedAt: {
          gte: pnlWindowStart,
          lt: openTime,
        },
      },
      select: {
        riskPctAtOpen: true,
        rAfterCost: true,
      },
    }),
    prisma.tradePlan.findMany({
      where: {
        status: "CLOSED",
        closedAt: {
          lt: openTime,
        },
      },
      orderBy: { closedAt: "desc" },
      select: {
        rAfterCost: true,
      },
    }),
    prisma.tradePlan.aggregate({
      where: {
        status: {
          in: ["OPEN", "CLOSING"],
        },
      },
      _sum: {
        riskPctAtOpen: true,
      },
    }),
  ]);

  const realizedPnl24hPct = computeRealizedPnl24hPct(recentClosedRows);
  const consecutiveLosses = computeConsecutiveLosses(closedHistoryRows);
  const { lastWinRAfterCost, last2WinsRAfterCostSum } =
    computeWinRecoveryStats(closedHistoryRows);

  return {
    realizedPnl24hPct,
    consecutiveLosses,
    lastWinRAfterCost,
    last2WinsRAfterCostSum,
    openRiskPct: openRiskAggregate._sum.riskPctAtOpen ?? 0,
  };
}

async function ensurePolicyAccountStateRow(args: {
  openTime: Date;
  metrics: AccountRiskMetrics;
  profileId?: string;
  scope?: string;
}): Promise<PolicyRiskMode> {
  const profileId = args.profileId ?? DEFAULT_POLICY_PROFILE_ID;
  const scope = args.scope ?? DEFAULT_POLICY_SCOPE;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.policyAccountState.findUnique({
      where: {
        profileId_scope: {
          profileId,
          scope,
        },
      },
    });

    if (existing) {
      return clampPolicyRiskMode(existing.riskMode);
    }

    const bootstrapRiskMode = computeNextPolicyRiskMode({
      prevRiskMode: "NORMAL",
      metrics: args.metrics,
    });

    await tx.policyAccountState.create({
      data: {
        profileId,
        scope,
        riskMode: bootstrapRiskMode,
        updatedAtUtc: args.openTime,
        lastTransitionReason: "BOOTSTRAP",
      },
    });

    return bootstrapRiskMode;
  });
}

async function loadEdgeStats(args: {
  signatureKeys: EdgeSignatureKeys;
}): Promise<{
  fineStats: EdgeSignatureStats | null;
  midStats: EdgeSignatureStats | null;
  coarseStats: EdgeSignatureStats | null;
}> {
  const rows = await prisma.edgeStat.findMany({
    where: {
      OR: [
        {
          signatureType: "fine",
          signatureKey: args.signatureKeys.fine,
        },
        {
          signatureType: "mid",
          signatureKey: args.signatureKeys.mid,
        },
        {
          signatureType: "coarse",
          signatureKey: args.signatureKeys.coarse,
        },
      ],
    },
  });

  const mapped = new Map(
    rows.map((row) => [
      `${row.signatureType}|${row.signatureKey}`,
      {
        meanR: row.meanR,
        stdR: row.stdR,
        n: row.n,
      } satisfies EdgeSignatureStats,
    ])
  );

  return {
    fineStats: mapped.get(`fine|${args.signatureKeys.fine}`) ?? null,
    midStats: mapped.get(`mid|${args.signatureKeys.mid}`) ?? null,
    coarseStats: mapped.get(`coarse|${args.signatureKeys.coarse}`) ?? null,
  };
}

async function loadRecentConcentrationHistory(args: {
  signal: Pick<SignalCandidate, "symbol" | "dir" | "time">;
}): Promise<ConcentrationHistoryItem[]> {
  const openTime = parseIsoDate(args.signal.time);
  if (!openTime) {
    return [];
  }

  const windowStart = new Date(
    openTime.getTime() - WINDOW_CONC_15M_MIN * 60 * 1000
  );

  const rows = await prisma.concentrationHistory.findMany({
    where: {
      symbol: args.signal.symbol.toUpperCase(),
      dir: args.signal.dir,
      openTimeUtc: {
        gte: windowStart,
        lt: openTime,
      },
    },
    orderBy: { openTimeUtc: "desc" },
  });

  return rows.map((row) => ({
    time: row.openTimeUtc.toISOString(),
    symbol: row.symbol,
    dir: row.dir as SignalCandidate["dir"],
    poiClusterKey: row.clusterKey,
  }));
}

export async function loadRuntimePolicyDbState(args: {
  signal: SignalCandidate;
  edgeSignatureKeys: EdgeSignatureKeys;
  profileId?: string;
  scope?: string;
  equityRefUsd?: number;
}): Promise<RuntimePolicyDbState | null> {
  const openTime = parseIsoDate(args.signal.time);
  if (!openTime) {
    return null;
  }

  const metrics = await loadAccountRiskMetrics(openTime);
  const storedRiskMode = await ensurePolicyAccountStateRow({
    openTime,
    metrics,
    profileId: args.profileId,
    scope: args.scope,
  });

  const [edgeStats, recentConcentrationHistory15m] = await Promise.all([
    loadEdgeStats({ signatureKeys: args.edgeSignatureKeys }),
    loadRecentConcentrationHistory({ signal: args.signal }),
  ]);

  const account = buildRuntimeAlertOnlyAccountSnapshotFromState({
    openTime: args.signal.time,
    equityRefUsd: args.equityRefUsd,
    riskMode: storedRiskMode,
    realizedPnl24hPct: metrics.realizedPnl24hPct,
    consecutiveLosses: metrics.consecutiveLosses,
    openRiskPct: metrics.openRiskPct,
    accountDataQuality: "STATIC",
  });

  if (!account) {
    return null;
  }

  return {
    account,
    recentConcentrationHistory15m,
    fineStats: edgeStats.fineStats,
    midStats: edgeStats.midStats,
    coarseStats: edgeStats.coarseStats,
    lastWinRAfterCost: metrics.lastWinRAfterCost,
    last2WinsRAfterCostSum: metrics.last2WinsRAfterCostSum,
    storedRiskMode,
  };
}

export async function upsertPolicyAccountRiskMode(args: {
  nextRiskMode: PolicyRiskMode;
  updatedAtUtc: string;
  profileId?: string;
  scope?: string;
  lastTransitionReason?: string | null;
}): Promise<void> {
  const updatedAt = parseIsoDate(args.updatedAtUtc);
  if (!updatedAt) {
    return;
  }

  const profileId = args.profileId ?? DEFAULT_POLICY_PROFILE_ID;
  const scope = args.scope ?? DEFAULT_POLICY_SCOPE;

  await prisma.policyAccountState.upsert({
    where: {
      profileId_scope: {
        profileId,
        scope,
      },
    },
    create: {
      profileId,
      scope,
      riskMode: args.nextRiskMode,
      updatedAtUtc: updatedAt,
      lastTransitionReason: args.lastTransitionReason ?? null,
    },
    update: {
      riskMode: args.nextRiskMode,
      updatedAtUtc: updatedAt,
      lastTransitionReason: args.lastTransitionReason ?? null,
    },
  });
}

export async function syncPolicyAccountStateAfterClose(args: {
  closeTime: string;
  profileId?: string;
  scope?: string;
}): Promise<void> {
  const closeTime = parseIsoDate(args.closeTime);
  if (!closeTime) {
    return;
  }

  const metrics = await loadAccountRiskMetrics(closeTime);
  const profileId = args.profileId ?? DEFAULT_POLICY_PROFILE_ID;
  const scope = args.scope ?? DEFAULT_POLICY_SCOPE;
  const existing = await prisma.policyAccountState.findUnique({
    where: {
      profileId_scope: {
        profileId,
        scope,
      },
    },
  });
  const prevRiskMode = existing
    ? clampPolicyRiskMode(existing.riskMode)
    : "NORMAL";
  const nextRiskMode = computeNextPolicyRiskMode({
    prevRiskMode,
    metrics,
  });

  await upsertPolicyAccountRiskMode({
    nextRiskMode,
    updatedAtUtc: closeTime.toISOString(),
    profileId,
    scope,
    lastTransitionReason: "CLOSE_COMMIT",
  });
}

function computeNextWelfordStats(args: {
  currentN: number;
  currentMean: number;
  currentM2: number;
  sample: number;
}): {
  n: number;
  meanR: number;
  stdR: number;
  m2: number;
} {
  const n = args.currentN + 1;
  const delta = args.sample - args.currentMean;
  const meanR = args.currentMean + delta / n;
  const delta2 = args.sample - meanR;
  const m2 = args.currentM2 + delta * delta2;
  const variance = n > 1 ? m2 / (n - 1) : 0;

  return {
    n,
    meanR,
    stdR: Math.sqrt(Math.max(variance, 0)),
    m2,
  };
}

async function upsertEdgeStatSample(args: {
  signatureType: "fine" | "mid" | "coarse";
  signatureKey: string;
  sample: number;
  updatedAtUtc: Date;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.edgeStat.findUnique({
      where: {
        signatureType_signatureKey: {
          signatureType: args.signatureType,
          signatureKey: args.signatureKey,
        },
      },
    });

    if (!existing) {
      await tx.edgeStat.create({
        data: {
          signatureType: args.signatureType,
          signatureKey: args.signatureKey,
          n: 1,
          meanR: args.sample,
          stdR: 0,
          m2: 0,
          updatedAtUtc: args.updatedAtUtc,
        },
      });
      return;
    }

    const next = computeNextWelfordStats({
      currentN: existing.n,
      currentMean: existing.meanR,
      currentM2: existing.m2,
      sample: args.sample,
    });

    await tx.edgeStat.update({
      where: {
        signatureType_signatureKey: {
          signatureType: args.signatureType,
          signatureKey: args.signatureKey,
        },
      },
      data: {
        n: next.n,
        meanR: next.meanR,
        stdR: next.stdR,
        m2: next.m2,
        updatedAtUtc: args.updatedAtUtc,
      },
    });
  });
}

export async function updateEdgeStatsFromClosedTradePlan(
  plan: TradePlan
): Promise<void> {
  if (
    !isFiniteNumber(plan.rAfterCost) ||
    typeof plan.closeTime !== "string" ||
    !plan.edgeSigFine ||
    !plan.edgeSigMid ||
    !plan.edgeSigCoarse
  ) {
    return;
  }

  const closeTime = parseIsoDate(plan.closeTime);
  if (!closeTime) {
    return;
  }

  await Promise.all([
    upsertEdgeStatSample({
      signatureType: "fine",
      signatureKey: plan.edgeSigFine,
      sample: plan.rAfterCost,
      updatedAtUtc: closeTime,
    }),
    upsertEdgeStatSample({
      signatureType: "mid",
      signatureKey: plan.edgeSigMid,
      sample: plan.rAfterCost,
      updatedAtUtc: closeTime,
    }),
    upsertEdgeStatSample({
      signatureType: "coarse",
      signatureKey: plan.edgeSigCoarse,
      sample: plan.rAfterCost,
      updatedAtUtc: closeTime,
    }),
  ]);
}

export async function insertConcentrationHistoryOnSendOpen(args: {
  candidateId: string;
  tradeKey: string;
  symbol: string;
  dir: SignalCandidate["dir"];
  clusterKey: string;
  source: SignalCandidate["source"];
  poiTier: SignalCandidate["poiTier"];
  openTimeUtc: string;
}): Promise<void> {
  const openTime = parseIsoDate(args.openTimeUtc);
  if (!openTime) {
    return;
  }

  await prisma.concentrationHistory.upsert({
    where: {
      tradeKey_openTimeUtc_clusterKey: {
        tradeKey: args.tradeKey,
        openTimeUtc: openTime,
        clusterKey: args.clusterKey,
      },
    },
    create: {
      candidateId: args.candidateId,
      tradeKey: args.tradeKey,
      symbol: args.symbol.toUpperCase(),
      dir: args.dir,
      clusterKey: args.clusterKey,
      source: args.source,
      poiTier: args.poiTier,
      openTimeUtc: openTime,
    },
    update: {
      candidateId: args.candidateId,
      source: args.source,
      poiTier: args.poiTier,
      createdAtUtc: new Date(),
    },
  });
}

export async function upsertPolicyDecisionLog(args: {
  signal: Pick<
    SignalCandidate,
    "candidateId" | "tradeKey" | "symbol" | "dir" | "source" | "poiTier" | "eventType" | "time"
  >;
  policy: PolicyResult;
}): Promise<void> {
  const candidateId = args.signal.candidateId;
  const openTime = parseIsoDate(args.signal.time);
  if (!candidateId || !openTime) {
    return;
  }

  await prisma.policyDecisionLog.upsert({
    where: {
      candidateId,
    },
    create: {
      candidateId,
      tradeKey: args.signal.tradeKey ?? candidateId,
      symbol: args.signal.symbol.toUpperCase(),
      dir: args.signal.dir,
      clusterKey: args.policy.derived.poiClusterKey,
      source: args.signal.source,
      poiTier: args.signal.poiTier,
      eventType: args.signal.eventType,
      decision: args.policy.decision,
      scoreDeltaSum: args.policy.policyScoreDeltaSum,
      policyTagsJson: args.policy.policyTags,
      reasonsJson: args.policy.reasons,
      evidenceLevel: args.policy.derived.evidenceLevel,
      usedSignature: args.policy.derived.usedSignature,
      riskMode: args.policy.riskMode,
      suggestedRiskPct: args.policy.suggestedRiskPct,
      openTimeUtc: openTime,
    },
    update: {
      tradeKey: args.signal.tradeKey ?? candidateId,
      symbol: args.signal.symbol.toUpperCase(),
      dir: args.signal.dir,
      clusterKey: args.policy.derived.poiClusterKey,
      source: args.signal.source,
      poiTier: args.signal.poiTier,
      eventType: args.signal.eventType,
      decision: args.policy.decision,
      scoreDeltaSum: args.policy.policyScoreDeltaSum,
      policyTagsJson: args.policy.policyTags,
      reasonsJson: args.policy.reasons,
      evidenceLevel: args.policy.derived.evidenceLevel,
      usedSignature: args.policy.derived.usedSignature,
      riskMode: args.policy.riskMode,
      suggestedRiskPct: args.policy.suggestedRiskPct,
      openTimeUtc: openTime,
    },
  });
}
