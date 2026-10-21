// src/lib/integrations/reviews.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients, crmHouseholds } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { listOpenReviews } from "./reviews";

const firmId = `test_firm_${randomBytes(4).toString("hex")}`;
const otherFirmId = `test_firm_${randomBytes(4).toString("hex")}`;

afterAll(async () => {
  for (const f of [firmId, otherFirmId]) {
    // Deleting the client cascades to its imports.
    await db.delete(clients).where(eq(clients.firmId, f));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, f));
  }
});

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
  it("lists only the firm's open reviews from this provider, with the household and account count", async () => {
    const { clientId } = await createTestClientWithScenario(firmId);
    await db
      .update(crmHouseholds)
      .set({ name: "Denise McCormick" })
      .where(eq(crmHouseholds.firmId, firmId));
    await addImport(clientId, firmId);
    // None of these are waiting on this firm's Addepar review:
    await addImport(clientId, firmId, { status: "committed" });
    await addImport(clientId, firmId, { origin: "orion" });
    await addImport(clientId, firmId, { origin: "extraction" });
    const { clientId: otherClientId } = await createTestClientWithScenario(otherFirmId);
    await addImport(otherClientId, otherFirmId);

    const reviews = await listOpenReviews(firmId, "addepar");

    expect(reviews).toEqual([
      { importId: expect.any(String), clientId, householdName: "Denise McCormick", accountCount: 3 },
    ]);
  });

  it("counts a review with no accounts list as zero rather than null", async () => {
    const { clientId } = await createTestClientWithScenario(otherFirmId);
    await addImport(clientId, otherFirmId, { origin: "schwab", payloadJson: {} });

    const reviews = await listOpenReviews(otherFirmId, "schwab");

    expect(reviews.map((r) => r.accountCount)).toEqual([0]);
  });

  it("returns nothing for a credentials-only provider", async () => {
    expect(await listOpenReviews(firmId, "azure_openai")).toEqual([]);
  });
});
