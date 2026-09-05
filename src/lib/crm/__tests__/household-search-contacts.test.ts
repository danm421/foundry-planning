import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts, crmHouseholdViews } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_hhsearch") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listCrmHouseholds, listRecentlyOpenedHouseholds } from "../households";

const ORG = "org_hhsearch";
const ADVISOR = "adv_search";
const USER = "user_search";

async function search(term: string) {
  const rows = await listCrmHouseholds({ search: term });
  return rows.map((r) => r.name).sort();
}

describe("clients list search covers contact names", () => {
  beforeEach(async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: USER,
      orgId: ORG,
      orgRole: "org:member",
    } as never);
    await db.delete(crmHouseholdViews).where(eq(crmHouseholdViews.firmId, ORG));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));

    const [trust] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG, advisorId: ADVISOR, name: "Redwood Legacy Trust" })
      .returning();
    const [other] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG, advisorId: ADVISOR, name: "Blue Harbor Group" })
      .returning();

    await db.insert(crmHouseholdContacts).values([
      {
        householdId: trust.id,
        role: "primary",
        firstName: "Marla",
        lastName: "Winters",
        preferredName: "Mimi",
      },
      // A second contact in the same household: EXISTS must not duplicate rows.
      { householdId: trust.id, role: "spouse", firstName: "Dexter", lastName: "Winters" },
      { householdId: other.id, role: "primary", firstName: "Owen", lastName: "Castellano" },
    ]);
  });

  it("still matches the household's own name", async () => {
    expect(await search("redwood")).toEqual(["Redwood Legacy Trust"]);
  });

  it("matches a contact's last name", async () => {
    expect(await search("winters")).toEqual(["Redwood Legacy Trust"]);
  });

  it("matches a contact's first name", async () => {
    expect(await search("castellano")).toEqual(["Blue Harbor Group"]);
    expect(await search("owen")).toEqual(["Blue Harbor Group"]);
  });

  it("matches a full name in either order", async () => {
    expect(await search("marla winters")).toEqual(["Redwood Legacy Trust"]);
    expect(await search("winters marla")).toEqual(["Redwood Legacy Trust"]);
  });

  it("matches a preferred name", async () => {
    expect(await search("mimi")).toEqual(["Redwood Legacy Trust"]);
  });

  it("returns a household once even when several contacts match", async () => {
    const rows = await listCrmHouseholds({ search: "winters" });
    expect(rows).toHaveLength(1);
  });

  it("still excludes non-matches", async () => {
    expect(await search("nobody-by-this-name")).toEqual([]);
  });

  it("searches contact names in the recently-opened view too", async () => {
    const [trust] = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.name, "Redwood Legacy Trust"));
    await db.insert(crmHouseholdViews).values({
      householdId: trust.id,
      firmId: ORG,
      userId: USER,
    });

    const rows = await listRecentlyOpenedHouseholds({ userId: USER, search: "winters" });
    expect(rows.map((r) => r.name)).toEqual(["Redwood Legacy Trust"]);
  });
});
