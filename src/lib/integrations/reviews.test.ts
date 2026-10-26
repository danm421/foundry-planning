// src/lib/integrations/reviews.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, crmHouseholds, integrationConnections, integrationHouseholdLinks } from "@/db/schema";
import { createByokConnection } from "./connections";
import { encodeAddeparConfig, encodeAddeparSecret } from "./providers/addepar/credentials";
import { createTestClientWithScenario } from "@/test/factories";
import { listOpenReviews } from "./reviews";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
const otherFirmId = `test_firm_${randomBytes(4).toString("hex")}`;

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  for (const f of [firmId, otherFirmId]) {
    // Connections first: their household links cascade with them.
    await db.delete(integrationConnections).where(eq(integrationConnections.firmId, f));
    // Deleting the client cascades to its imports.
    await db.delete(clients).where(eq(clients.firmId, f));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, f));
  }
});

/** A BYOK Addepar connection, with `clientId` linked through it. */
async function connectionLinking(clientId: string, firm: string, owner: string): Promise<string> {
  const connectionId = await createByokConnection({
    firmId: firm,
    ownerUserId: owner,
    name: "Addepar",
    secretBlob: encodeAddeparSecret({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://api.addepar.com", addeparFirmId: "42" }),
  });
  await db.insert(integrationHouseholdLinks).values({
    firmId: firm,
    provider: "addepar",
    connectionId,
    clientId,
    externalHouseholdId: `hh-${clientId.slice(0, 8)}`,
    externalFirmId: "42",
    linkedByUserId: owner,
  });
  return connectionId;
}

async function addImport(
  clientId: string,
  orgId: string,
  over: Partial<typeof clientImports.$inferInsert> = {},
) {
  await db.insert(clientImports).values({
    clientId,
    orgId,
    mode: "updating",
    status: "review",
    createdByUserId: "system:addepar-sync",
    origin: "addepar",
    payloadJson: { payload: { accounts: [{ name: "IRA" }, { name: "Trust" }, { name: "LLC" }] } },
    ...over,
  });
}

describe("listOpenReviews", () => {
  it("lists only reviews for clients linked through this connection, with the household and account count", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);
    const [{ householdId }] = await db
      .select({ householdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, clientId));
    await db
      .update(crmHouseholds)
      .set({ name: "Denise McCormick" })
      .where(eq(crmHouseholds.id, householdId!));
    const connectionId = await connectionLinking(clientId, firmId, "advisorA");
    await addImport(clientId, firmId);
    // None of these are waiting on this connection's review:
    await addImport(clientId, firmId, { status: "committed" });
    await addImport(clientId, firmId, { origin: "orion" });
    await addImport(clientId, firmId, { origin: "extraction" });
    // A colleague's client, linked through their own connection.
    const { clientId: colleagueClient } = await createTestClientWithScenario(firmId);
    await connectionLinking(colleagueClient, firmId, "advisorB");
    await addImport(colleagueClient, firmId);
    // An unlinked client with an open review.
    const { clientId: unlinked } = await createTestClientWithScenario(firmId);
    await addImport(unlinked, firmId);

    const reviews = await listOpenReviews(connectionId);

    expect(reviews).toEqual([
      { importId: expect.any(String), clientId, householdName: "Denise McCormick", accountCount: 3 },
    ]);
  });

  it("counts a review with no accounts list as zero rather than null", async () => {
    const { clientId } = await createTestClientWithScenario(otherFirmId);
    const connectionId = await connectionLinking(clientId, otherFirmId, "advisorA");
    await addImport(clientId, otherFirmId, { payloadJson: {} });

    const reviews = await listOpenReviews(connectionId);

    expect(reviews.map((r) => r.accountCount)).toEqual([0]);
  });
});
