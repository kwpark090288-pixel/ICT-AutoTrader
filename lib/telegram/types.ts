export type TelegramMessageType = "SEND_OPEN" | "SEND_CLOSE";

export interface TelegramDispatchConfig {
  enabled: boolean;
  botToken: string | null;
  chatId: string | null;
}

export interface TelegramDispatchDecision {
  shouldDispatch: boolean;
  reason:
    | "OK"
    | "TELEGRAM_DISABLED"
    | "MISSING_BOT_TOKEN"
    | "MISSING_CHAT_ID";
}

export interface TelegramSendMessageResult {
  ok: boolean;
  tgMessageId: string | null;
  error: string | null;
}

export interface TelegramDispatchSummary {
  attempted: number;
  sent: number;
  failed: number;
  skippedReason: TelegramDispatchDecision["reason"] | null;
}
