/* telegram_smoke_test.js (one-shot) */
const enabled = String(process.env.TELEGRAM_ENABLED || "").toLowerCase() === "true";
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

async function main() {
  if (!enabled) {
    console.log("[telegram_smoke_test] TELEGRAM_ENABLED!=true -> skip");
    process.exit(0);
  }
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing TELEGRAM_CHAT_ID");

  const text = `[SMOKE_TEST] ${new Date().toISOString()} ping`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("[telegram_smoke_test] FAILED", json);
    process.exit(1);
  }
  console.log("[telegram_smoke_test] OK", { tg_message_id: json?.result?.message_id });
}

main().catch((e) => {
  console.error("[telegram_smoke_test] ERROR", e);
  process.exit(1);
});