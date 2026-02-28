-- CreateEnum
CREATE TYPE "TelegramOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TradePlanStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "telegram_outbox" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "plan_id" TEXT,
    "symbol" TEXT,
    "tf" TEXT,
    "direction" TEXT,
    "payload_text" TEXT NOT NULL,
    "status" "TelegramOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "tg_message_id" TEXT,

    CONSTRAINT "telegram_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_plans" (
    "plan_id" TEXT NOT NULL,
    "status" "TradePlanStatus" NOT NULL DEFAULT 'OPEN',
    "symbol" TEXT NOT NULL,
    "tf" TEXT,
    "direction" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_plans_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symbol" TEXT,
    "tf" TEXT,
    "event_text" TEXT NOT NULL,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seen_state" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "seen_at_utc" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seen_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mute_state" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tf" TEXT NOT NULL,
    "direction" TEXT,
    "mute_until_utc" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mute_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_state" (
    "scope_key" TEXT NOT NULL,
    "syncing" BOOLEAN NOT NULL DEFAULT true,
    "data_ok" BOOLEAN NOT NULL DEFAULT false,
    "gap_detected" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "details_json" JSONB,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("scope_key")
);

-- CreateTable
CREATE TABLE "review_notes" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "note_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_outbox_idempotency_key_key" ON "telegram_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "telegram_outbox_status_next_attempt_at_idx" ON "telegram_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "trade_plans_symbol_status_opened_at_idx" ON "trade_plans"("symbol", "status", "opened_at");

-- CreateIndex
CREATE INDEX "signals_created_at_idx" ON "signals"("created_at");

-- CreateIndex
CREATE INDEX "signals_symbol_tf_created_at_idx" ON "signals"("symbol", "tf", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seen_state_profile_id_event_id_key" ON "seen_state"("profile_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "mute_state_profile_id_symbol_tf_direction_key" ON "mute_state"("profile_id", "symbol", "tf", "direction");

-- CreateIndex
CREATE INDEX "review_notes_plan_id_created_at_idx" ON "review_notes"("plan_id", "created_at");
