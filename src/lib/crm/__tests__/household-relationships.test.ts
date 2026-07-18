import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdRelationships } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  listHouseholdRelationships,
  createHouseholdRelationship,
  deleteHouseholdRelationship,
  HouseholdsAlreadyLinkedError,
  SelfLinkError,
} from "../household-relationships";

const TEST_ORG = "test_org_hh_rel";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test_org_hh_rel") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn().mockResolvedValue({ userId: "test_user", orgId: "test_org_hh_rel" }) };
});

async function seedHousehold(name: string, extra: Partial<typeof crmHouseholds.$inferInsert> = {}) {
  const [h] = await db.insert(crmHouseholds).values({
    firmId: TEST_ORG, advisorId: "test_advisor", name, ...extra,
  }).returning();
  return h;
}

describe("household relationships service", () => {
  beforeEach(async () => {
    // No clients rows are created in this file, so households delete cleanly;
    // edges go with them via cascade.
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, TEST_ORG));
  });

  it("creates a child link and lists it with perspective labels on both sides", async () => {
    const parents = await seedHousehold("Cooper Household");
    const child = await seedHousehold("Sarah Cooper");
    // From the child page: "this household is the child of the selected" → viewerSide from.
    await createHouseholdRelationship(child.id, {
      counterpartHouseholdId: parents.id, type: "child", viewerSide: "from", note: "Promoted 2026",
    });

    const onChildPage = await listHouseholdRelationships(child.id);
    expect(onChildPage).toHaveLength(1);
    expect(onChildPage[0].label).toBe("Parent");
    expect(onChildPage[0].counterpart.name).toBe("Cooper Household");

    const onParentsPage = await listHouseholdRelationships(parents.id);
    expect(onParentsPage).toHaveLength(1);
    expect(onParentsPage[0].label).toBe("Child");
    expect(onParentsPage[0].counterpart.name).toBe("Sarah Cooper");
  });

  it("normalizes viewerSide 'to' into the canonical columns", async () => {
    const parents = await seedHousehold("Cooper Household");
    const child = await seedHousehold("Sarah Cooper");
    // From the parents page: "this household is the parent of the selected".
    await createHouseholdRelationship(parents.id, {
      counterpartHouseholdId: child.id, type: "child", viewerSide: "to",
    });
    const rows = await db.query.crmHouseholdRelationships.findMany({
      where: eq(crmHouseholdRelationships.firmId, TEST_ORG),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].fromHouseholdId).toBe(child.id); // from = the child
    expect(rows[0].toHouseholdId).toBe(parents.id);
  });

  it("rejects a duplicate link in either direction", async () => {
    const a = await seedHousehold("A");
    const b = await seedHousehold("B");
    await createHouseholdRelationship(a.id, { counterpartHouseholdId: b.id, type: "sibling", viewerSide: "from" });
    await expect(
      createHouseholdRelationship(b.id, { counterpartHouseholdId: a.id, type: "business_partner", viewerSide: "from" }),
    ).rejects.toThrow(HouseholdsAlreadyLinkedError);
  });

  it("rejects self-links", async () => {
    const a = await seedHousehold("A");
    await expect(
      createHouseholdRelationship(a.id, { counterpartHouseholdId: a.id, type: "other", viewerSide: "from" }),
    ).rejects.toThrow(SelfLinkError);
  });

  it("rejects a counterpart outside the caller's firm", async () => {
    const a = await seedHousehold("A");
    const [foreign] = await db.insert(crmHouseholds).values({
      firmId: "some_other_org_hh_rel", advisorId: "x", name: "Foreign",
    }).returning();
    try {
      await expect(
        createHouseholdRelationship(a.id, { counterpartHouseholdId: foreign.id, type: "sibling", viewerSide: "from" }),
      ).rejects.toThrow(/not found or access denied/);
    } finally {
      await db.delete(crmHouseholds).where(eq(crmHouseholds.id, foreign.id));
    }
  });

  it("hides links whose counterpart is in Trash and unhides on restore", async () => {
    const a = await seedHousehold("A");
    const b = await seedHousehold("B");
    await createHouseholdRelationship(a.id, { counterpartHouseholdId: b.id, type: "sibling", viewerSide: "from" });
    await db.update(crmHouseholds).set({ deletedAt: new Date(), deletedBy: "t" }).where(eq(crmHouseholds.id, b.id));
    expect(await listHouseholdRelationships(a.id)).toHaveLength(0);
    await db.update(crmHouseholds).set({ deletedAt: null, deletedBy: null }).where(eq(crmHouseholds.id, b.id));
    expect(await listHouseholdRelationships(a.id)).toHaveLength(1);
  });

  it("deletes a link from either end", async () => {
    const a = await seedHousehold("A");
    const b = await seedHousehold("B");
    const row = await createHouseholdRelationship(a.id, { counterpartHouseholdId: b.id, type: "sibling", viewerSide: "from" });
    await deleteHouseholdRelationship(b.id, row.id); // delete via the OTHER end
    expect(await listHouseholdRelationships(a.id)).toHaveLength(0);
  });
});
