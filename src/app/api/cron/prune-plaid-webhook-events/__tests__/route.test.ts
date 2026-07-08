// PII audit F4: plaid_webhook_events is intentionally FK-less (rows survive
// item unlink) and has no other deletion path — this cron is the sole thing
// bounding the table. Real DB so the age predicate is genuinely exercised;
// test rows are namespaced by plaid_item_id prefix and swept in beforeEach.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { plaidWebhookEvents } from "@/db/schema";
import { like } from "drizzle-orm";

import { GET } from "../route";

const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = "test-f4-prune-";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

async function seedEvent(suffix: string, createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(plaidWebhookEvents)
    .values({
      plaidItemId: `${PREFIX}${suffix}`,
      webhookType: "TRANSACTIONS",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
      createdAt,
    })
    .returning({ id: plaidWebhookEvents.id });
  return row.id;
}

beforeEach(async () => {
  process.env.CRON_SECRET = "secret_t";
  await db
    .delete(plaidWebhookEvents)
    .where(like(plaidWebhookEvents.plaidItemId, `${PREFIX}%`));
});

const authed = () =>
  new Request("http://test/api/cron/prune-plaid-webhook-events", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("GET /api/cron/prune-plaid-webhook-events", () => {
  it("rejects a missing/incorrect secret (fail-closed)", async () => {
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(401);
  });

  it("401s when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(
      new Request("http://test", { headers: { authorization: "Bearer " } }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("deletes events older than the retention window and keeps fresh ones", async () => {
    const oldId = await seedEvent("old", daysAgo(91));
    const freshId = await seedEvent("fresh", daysAgo(89));

    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: plaidWebhookEvents.id })
      .from(plaidWebhookEvents)
      .where(like(plaidWebhookEvents.plaidItemId, `${PREFIX}%`));
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(freshId);
  });
});
