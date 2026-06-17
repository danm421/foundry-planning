import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/db";
import { clientShares, clients, crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";

const FIRM = "org_cs_schema";

describe("client_shares schema", () => {
  afterAll(async () => {
    await db.delete(clientShares).where(eq(clientShares.firmId, FIRM));
    await db.delete(clients).where(eq(clients.firmId, FIRM));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
  });

  it("inserts a share-all row and reads isPrivate default", async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "adv", name: "HH" })
      .returning();
    const [c] = await db
      .insert(clients)
      .values({ firmId: FIRM, advisorId: "adv", crmHouseholdId: hh.id, retirementAge: 65, planEndAge: 95 })
      .returning();
    expect(c.isPrivate).toBe(false);

    const [share] = await db
      .insert(clientShares)
      .values({
        firmId: FIRM, ownerUserId: "adv", recipientUserId: "rcpt",
        recipientEmail: "r@x.com", scope: "all", permission: "view", createdBy: "adv",
      })
      .returning();
    expect(share.scope).toBe("all");
    expect(share.revokedAt).toBeNull();
  });
});
