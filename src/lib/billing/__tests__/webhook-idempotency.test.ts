import { describe, it, expect, beforeAll } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

const skip = !process.env.INTEGRATION_DB_URL;
const describeFn = skip ? describe.skip : describe;

describeFn("webhook idempotency (integration)", () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    const sql = neon(process.env.INTEGRATION_DB_URL!);
    testDb = drizzle(sql, { schema });
  });

  it("rejects duplicate stripe_event_id at INSERT", async () => {
    const eventId = `evt_test_${Date.now()}`;
    await testDb.insert(schema.billingEvents).values({
      stripeEventId: eventId,
      eventType: "customer.subscription.updated",
      result: null,
    });
    const second = await testDb
      .insert(schema.billingEvents)
      .values({
        stripeEventId: eventId,
        eventType: "customer.subscription.updated",
        result: null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.billingEvents.id });
    expect(second).toEqual([]);
    await testDb
      .delete(schema.billingEvents)
      .where(eq(schema.billingEvents.stripeEventId, eventId));
  });
});
