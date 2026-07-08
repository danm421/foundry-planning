/**
 * Points every existing Plaid item at the webhook receiver via
 * /item/webhook/update. Idempotent — safe to re-run. Each success makes Plaid
 * fire WEBHOOK_UPDATE_ACKNOWLEDGED at the new URL, so rows appearing in
 * plaid_webhook_events double as end-to-end delivery confirmation.
 *
 * Usage (env inline — never edit .env.local):
 *   DATABASE_URL=<url> PLAID_CLIENT_ID=... PLAID_SECRET=... PLAID_ENV=production \
 *   PLAID_ENCRYPTION_KEY=... \
 *   PLAID_WEBHOOK_URL=https://app.foundryplanning.com/api/webhooks/plaid \
 *   npx tsx scripts/backfill-plaid-webhooks.ts
 */
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { getPlaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/plaid/crypto";
import { plaidWebhookUrl } from "@/lib/plaid/webhook-url";

async function main() {
  const webhook = plaidWebhookUrl();
  if (!webhook) {
    throw new Error("Set PLAID_WEBHOOK_URL (or run with VERCEL_ENV=production)");
  }
  const items = await db
    .select({
      plaidItemId: plaidItems.plaidItemId,
      institutionName: plaidItems.institutionName,
      accessToken: plaidItems.accessToken,
    })
    .from(plaidItems);
  console.log(`updating ${items.length} item(s) → ${webhook}`);
  const plaid = getPlaidClient();
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await plaid.itemWebhookUpdate({
        access_token: decrypt(item.accessToken),
        webhook,
      });
      ok++;
      console.log(`  ok   ${item.institutionName ?? "?"} (${item.plaidItemId})`);
    } catch (err) {
      failed++;
      console.error(
        `  FAIL ${item.plaidItemId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`done: ${ok} updated, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
