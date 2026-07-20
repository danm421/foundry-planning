// src/lib/integrations/households.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { clients, crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTestClientWithScenario } from "@/test/factories";
import {
  getHouseholdLinks,
  linkHousehold,
  unlinkHousehold,
  getHouseholdLinkForClient,
} from "./households";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  // Delete clients by firmId — cascades to integrationHouseholdLinks and crmHouseholds
  const clientRows = await db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId));
  for (const c of clientRows) {
    await db.delete(clients).where(eq(clients.id, c.id));
  }
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
});

describe("integration household links", () => {
  it("linkHousehold inserts a row; getHouseholdLinks returns it", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);
    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hhA", userId: "user1" });

    const rows = await getHouseholdLinks(firmId, "orion");
    const row = rows.find((r) => r.clientId === clientId);
    expect(row).toBeDefined();
    expect(row?.externalHouseholdId).toBe("hhA");
    expect(row?.linkedByUserId).toBe("user1");
  });

  it("linkHousehold with same clientId updates in place (onConflict)", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);

    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hhB", userId: "user1" });
    const beforeRows = await getHouseholdLinks(firmId, "orion");
    const before = beforeRows.find((r) => r.clientId === clientId);
    expect(before?.externalHouseholdId).toBe("hhB");
    const beforeUpdatedAt = before?.updatedAt;

    // Small delay so updatedAt advances
    await new Promise((resolve) => setTimeout(resolve, 10));

    await linkHousehold({
      firmId,
      providerId: "orion",
      clientId,
      externalHouseholdId: "hhB_updated",
      userId: "user1",
    });
    const afterRows = await getHouseholdLinks(firmId, "orion");
    const matching = afterRows.filter((r) => r.clientId === clientId);
    expect(matching).toHaveLength(1);
    expect(matching[0].externalHouseholdId).toBe("hhB_updated");
    expect(matching[0].updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdatedAt!.getTime());
  });

  it("unlinkHousehold deletes the row; getHouseholdLinks no longer returns it", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);
    await linkHousehold({ firmId, providerId: "orion", clientId, externalHouseholdId: "hhC", userId: "user2" });

    // Confirm it exists
    const before = await getHouseholdLinks(firmId, "orion");
    expect(before.some((r) => r.clientId === clientId)).toBe(true);

    await unlinkHousehold(firmId, clientId);

    const after = await getHouseholdLinks(firmId, "orion");
    expect(after.some((r) => r.clientId === clientId)).toBe(false);
  });

  it("re-links a client to a different provider rather than duplicating", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);

    await linkHousehold({
      firmId: "firm_1",
      providerId: "orion",
      clientId,
      externalHouseholdId: "hh-orion",
      userId: "u1",
    });
    await linkHousehold({
      firmId: "firm_1",
      providerId: "schwab",
      clientId,
      externalHouseholdId: "hh-schwab",
      userId: "u1",
    });

    // The client_id unique constraint means the second link REPLACES the first —
    // one source of truth per client, never two providers feeding one plan.
    const link = await getHouseholdLinkForClient(clientId);
    expect(link).toMatchObject({ provider: "schwab", externalHouseholdId: "hh-schwab" });
    expect(await getHouseholdLinks("firm_1", "orion")).toHaveLength(0);
  });
});
