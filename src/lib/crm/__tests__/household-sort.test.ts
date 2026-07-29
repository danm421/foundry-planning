import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_hhsort") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listCrmHouseholds } from "../households";

const ORG = "org_hhsort";
const ADV = "adv_sort";

async function seed(
  rows: Array<{ name: string; primary?: [string, string] }>,
) {
  for (const r of rows) {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG, advisorId: ADV, name: r.name })
      .returning();
    if (r.primary) {
      await db.insert(crmHouseholdContacts).values({
        householdId: hh.id,
        role: "primary",
        firstName: r.primary[0],
        lastName: r.primary[1],
      });
    }
  }
}

describe("listCrmHouseholds sorting", () => {
  beforeEach(async () => {
    // Contacts cascade on household delete.
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
    vi.mocked(auth).mockResolvedValue({
      userId: "user_sort",
      orgId: ORG,
      orgRole: "org:member",
    } as never);
  });

  it("orders by the primary contact's LAST name, not the displayed name", async () => {
    // Displayed names are first-name-led, so a naive sort on `name` would
    // give Amy, Bob, Zoe. Sorting by last name must give Adams before Baker.
    await seed([
      { name: "Zoe Adams", primary: ["Zoe", "Adams"] },
      { name: "Amy Baker", primary: ["Amy", "Baker"] },
      { name: "Bob Adams", primary: ["Bob", "Adams"] },
    ]);

    const rows = await listCrmHouseholds({ sort: "name", dir: "asc" });

    expect(rows.map((r) => r.name)).toEqual(["Bob Adams", "Zoe Adams", "Amy Baker"]);
  });

  it("sorts households with no primary contact LAST when ascending", async () => {
    await seed([
      { name: "No Contacts" },
      { name: "Amy Baker", primary: ["Amy", "Baker"] },
    ]);

    const rows = await listCrmHouseholds({ sort: "name", dir: "asc" });

    expect(rows.map((r) => r.name)).toEqual(["Amy Baker", "No Contacts"]);
  });

  it("sorts households with no primary contact LAST when descending too", async () => {
    // The point of the design: nulls last in BOTH directions, so incomplete
    // records never occupy the top of the list.
    await seed([
      { name: "No Contacts" },
      { name: "Amy Baker", primary: ["Amy", "Baker"] },
      { name: "Zoe Adams", primary: ["Zoe", "Adams"] },
    ]);

    const rows = await listCrmHouseholds({ sort: "name", dir: "desc" });

    expect(rows.map((r) => r.name)).toEqual(["Amy Baker", "Zoe Adams", "No Contacts"]);
  });

  it("sorts the primary-contact key by FIRST name", async () => {
    await seed([
      { name: "Zoe Adams", primary: ["Zoe", "Adams"] },
      { name: "Amy Baker", primary: ["Amy", "Baker"] },
      { name: "Bob Adams", primary: ["Bob", "Adams"] },
    ]);

    const rows = await listCrmHouseholds({ sort: "primary", dir: "asc" });

    expect(rows.map((r) => r.name)).toEqual(["Amy Baker", "Bob Adams", "Zoe Adams"]);
  });

  it("keeps the existing updatedAt default when no sort is given", async () => {
    await seed([
      { name: "Zoe Adams", primary: ["Zoe", "Adams"] },
      { name: "Amy Baker", primary: ["Amy", "Baker"] },
    ]);
    // Make Zoe the most recently updated. Without this the two rows share an
    // insert-time timestamp and the assertion would pass whatever the order is.
    await db
      .update(crmHouseholds)
      .set({ updatedAt: new Date(Date.UTC(2030, 0, 1)) })
      .where(eq(crmHouseholds.name, "Zoe Adams"));

    const rows = await listCrmHouseholds();

    // updatedAt desc — Zoe first, DESPITE Baker losing on last name.
    expect(rows.map((r) => r.name)).toEqual(["Zoe Adams", "Amy Baker"]);
  });

  it("sorts status in lifecycle order, not alphabetical order", async () => {
    // crmHouseholdStatusEnum is declared prospect → active → inactive →
    // archived and Postgres sorts enums by declaration order. Alphabetical
    // would give active, archived, inactive, prospect — a different answer,
    // so this test fails if someone casts the column to text.
    const [a] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG, advisorId: ADV, name: "Archived HH", status: "archived" })
      .returning();
    const [p] = await db
      .insert(crmHouseholds)
      .values({ firmId: ORG, advisorId: ADV, name: "Prospect HH", status: "prospect" })
      .returning();
    expect(a.id).toBeTruthy();
    expect(p.id).toBeTruthy();

    const rows = await listCrmHouseholds({ sort: "status", dir: "asc" });

    expect(rows.map((r) => r.name)).toEqual(["Prospect HH", "Archived HH"]);
  });

  it("pages deterministically when many households share a sort value", async () => {
    // Without the id tie-break, Postgres may return the same row on two pages
    // (or none), because the ORDER BY alone does not define a total order.
    await seed([
      { name: "Same One", primary: ["Sam", "Same"] },
      { name: "Same Two", primary: ["Sam", "Same"] },
      { name: "Same Three", primary: ["Sam", "Same"] },
      { name: "Same Four", primary: ["Sam", "Same"] },
    ]);

    const page1 = await listCrmHouseholds({ sort: "name", dir: "asc", limit: 2, offset: 0 });
    const page2 = await listCrmHouseholds({ sort: "name", dir: "asc", limit: 2, offset: 2 });

    const ids = [...page1.map((r) => r.id), ...page2.map((r) => r.id)];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4); // no duplicates, nothing skipped
  });
});
