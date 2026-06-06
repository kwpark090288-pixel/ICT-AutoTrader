import type { TelegramOutbox } from "@prisma/client";
import type { TradePlan } from "../tradelifecycle/types";
import {
  DEFAULT_TELEGRAM_REFERENCE_LEVERAGE,
  TELEGRAM_OUTBOX_BATCH_LIMIT,
  TELEGRAM_RETRY_DELAYS_MIN,
} from "./constants";
import {
  formatTelegramTradeCloseMessage,
  formatTelegramTradeOpenMessage,
} from "./format";
import type {
  TelegramDispatchConfig,
  TelegramDispatchDecision,
  TelegramDispatchSummary,
  TelegramSendMessageResult,
} from "./types";

type SendTelegramFetch = typeof fetch;

async function getPrisma() {
  const mod = await import("../db/prisma");
  return mod.prisma;
}

export function loadTelegramDispatchConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env
): TelegramDispatchConfig {
  const enabled = String(env.TELEGRAM_ENABLED ?? "").toLowerCase() === "true";
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const chatId = env.TELEGRAM_CHAT_ID?.trim() || null;

  return {
    enabled,
    botToken,
    chatId,
  };
}

export function evaluateTelegramDispatchReadiness(
  config: TelegramDispatchConfig
): TelegramDispatchDecision {
  if (!config.enabled) {
    return {
      shouldDispatch: false,
      reason: "TELEGRAM_DISABLED",
    };
  }

  if (!config.botToken) {
    return {
      shouldDispatch: false,
      reason: "MISSING_BOT_TOKEN",
    };
  }

  if (!config.chatId) {
    return {
      shouldDispatch: false,
      reason: "MISSING_CHAT_ID",
    };
  }

  return {
    shouldDispatch: true,
    reason: "OK",
  };
}

export function buildTelegramOpenIdempotencyKey(planId: string): string {
  return `${planId}|TELEGRAM|OPEN`;
}

export function buildTelegramCloseIdempotencyKey(planId: string): string {
  return `${planId}|TELEGRAM|CLOSE`;
}

export function buildTelegramOpenOutboxCreateInput(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
) {
  return {
    idempotencyKey: buildTelegramOpenIdempotencyKey(plan.planId),
    messageType: "SEND_OPEN",
    planId: plan.planId,
    symbol: plan.symbol,
    tf: plan.tf ?? null,
    direction: plan.dir,
    payloadText: formatTelegramTradeOpenMessage(plan, referenceLeverage),
  };
}

export function buildTelegramCloseOutboxCreateInput(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
) {
  return {
    idempotencyKey: buildTelegramCloseIdempotencyKey(plan.planId),
    messageType: "SEND_CLOSE",
    planId: plan.planId,
    symbol: plan.symbol,
    tf: plan.tf ?? null,
    direction: plan.dir,
    payloadText: formatTelegramTradeCloseMessage(plan, referenceLeverage),
  };
}

export async function enqueueTelegramTradeOpen(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
): Promise<TelegramOutbox> {
  const prisma = await getPrisma();
  const data = buildTelegramOpenOutboxCreateInput(plan, referenceLeverage);
  const existing = await prisma.telegramOutbox.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });

  if (existing) {
    return existing;
  }

  return prisma.telegramOutbox.create({ data });
}

export async function enqueueTelegramTradeClose(
  plan: TradePlan,
  referenceLeverage: number = DEFAULT_TELEGRAM_REFERENCE_LEVERAGE
): Promise<TelegramOutbox> {
  const prisma = await getPrisma();
  const data = buildTelegramCloseOutboxCreateInput(plan, referenceLeverage);
  const existing = await prisma.telegramOutbox.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });

  if (existing) {
    return existing;
  }

  return prisma.telegramOutbox.create({ data });
}

export function computeTelegramNextAttemptAt(
  attemptCount: number,
  now: Date = new Date()
): Date {
  const idx = Math.max(
    0,
    Math.min(TELEGRAM_RETRY_DELAYS_MIN.length - 1, attemptCount - 1)
  );
  const delayMin = TELEGRAM_RETRY_DELAYS_MIN[idx];
  return new Date(now.getTime() + delayMin * 60 * 1000);
}

export async function listDueTelegramOutbox(
  now: Date = new Date(),
  limit: number = TELEGRAM_OUTBOX_BATCH_LIMIT
): Promise<TelegramOutbox[]> {
  const prisma = await getPrisma();
  return prisma.telegramOutbox.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export async function beginTelegramOutboxAttempt(
  id: string
): Promise<TelegramOutbox> {
  const prisma = await getPrisma();
  return prisma.telegramOutbox.update({
    where: { id },
    data: {
      status: "SENDING",
      attemptCount: {
        increment: 1,
      },
    },
  });
}

export async function markTelegramOutboxSent(
  id: string,
  tgMessageId: string | null,
  sentAt: Date = new Date()
): Promise<TelegramOutbox> {
  const prisma = await getPrisma();
  return prisma.telegramOutbox.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt,
      tgMessageId,
      lastError: null,
    },
  });
}

export async function markTelegramOutboxFailed(
  id: string,
  attemptCount: number,
  lastError: string,
  now: Date = new Date()
): Promise<TelegramOutbox> {
  const prisma = await getPrisma();
  return prisma.telegramOutbox.update({
    where: { id },
    data: {
      status: "FAILED",
      lastError,
      nextAttemptAt: computeTelegramNextAttemptAt(attemptCount, now),
    },
  });
}

export async function sendTelegramText(
  config: TelegramDispatchConfig,
  text: string,
  fetchImpl: SendTelegramFetch = fetch
): Promise<TelegramSendMessageResult> {
  const readiness = evaluateTelegramDispatchReadiness(config);

  if (!readiness.shouldDispatch) {
    return {
      ok: false,
      tgMessageId: null,
      error: readiness.reason,
    };
  }

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
    }),
  });

  const json = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number | string };
  };

  if (!res.ok || json.ok !== true) {
    return {
      ok: false,
      tgMessageId: null,
      error: json.description ?? `HTTP_${res.status}`,
    };
  }

  return {
    ok: true,
    tgMessageId:
      json.result?.message_id == null ? null : String(json.result.message_id),
    error: null,
  };
}

export async function dispatchDueTelegramOutboxOnce(
  fetchImpl: SendTelegramFetch = fetch
): Promise<TelegramDispatchSummary> {
  const config = loadTelegramDispatchConfig();
  const readiness = evaluateTelegramDispatchReadiness(config);

  if (!readiness.shouldDispatch) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skippedReason: readiness.reason,
    };
  }

  const due = await listDueTelegramOutbox();

  let sent = 0;
  let failed = 0;

  for (const entry of due) {
    const claimed = await beginTelegramOutboxAttempt(entry.id);

    try {
      const result = await sendTelegramText(
        config,
        claimed.payloadText,
        fetchImpl
      );

      if (!result.ok) {
        failed += 1;
        await markTelegramOutboxFailed(
          claimed.id,
          claimed.attemptCount,
          result.error ?? "UNKNOWN"
        );
        continue;
      }

      sent += 1;
      await markTelegramOutboxSent(claimed.id, result.tgMessageId);
    } catch (error) {
      failed += 1;
      await markTelegramOutboxFailed(
        claimed.id,
        claimed.attemptCount,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return {
    attempted: due.length,
    sent,
    failed,
    skippedReason: null,
  };
}
