import "dotenv/config";

import { dispatchDueTelegramOutboxOnce } from "../lib/telegram/outbox";

async function main() {
  const summary = await dispatchDueTelegramOutboxOnce();
  console.log("[TELEGRAM_DISPATCH_ONCE]", JSON.stringify(summary));
}

main().catch((error) => {
  console.error(
    "[TELEGRAM_DISPATCH_ONCE_ERROR]",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
