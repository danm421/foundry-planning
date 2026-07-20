import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncHouseholdNameFromContacts } from "../sync-household-name";

const FIRM = "test_org_sync_name";

async function makeHousehold(name: string, nameIsCustom = false) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: "test_advisor", name, nameIsCustom })
    .returning();
  return h.id;
}

async function addContact(
  householdId: string,
  role: "primary" | "spouse" | "dependent",
  firstName: string,
  lastName: string,
) {
  await db
    .insert(crmHouseholdContacts)
    .values({ householdId, role, firstName, lastName });
}

async function nameOf(householdId: string) {
  const [row] = await db
    .select({ name: crmHouseholds.name })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, householdId));
  return row.name;
}

describe("syncHouseholdNameFromContacts", () => {
  beforeEach(async () => {
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
  });

  it("rewrites a stale name and reports 'updated'", async () => {
    const id = await makeHousehold("Stale Name");
    await addContact(id, "primary", "John", "Smith");
    await addContact(id, "spouse", "Jane", "Smith");

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("updated");
    expect(result.name).toBe("John & Jane Smith");
    expect(await nameOf(id)).toBe("John & Jane Smith");
  });

  it("collapses to the primary alone once the spouse contact is gone", async () => {
    const id = await makeHousehold("John & Jane Smith");
    await addContact(id, "primary", "John", "Smith");

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("updated");
    expect(await nameOf(id)).toBe("John Smith");
  });

  it("leaves a locked household alone and reports 'locked'", async () => {
    const id = await makeHousehold("Smith Family Trust", true);
    await addContact(id, "primary", "John", "Smith");

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("locked");
    expect(result.name).toBe("Smith Family Trust");
    expect(await nameOf(id)).toBe("Smith Family Trust");
  });

  it("reports 'unchanged' when the derived name already matches", async () => {
    const id = await makeHousehold("John Smith");
    await addContact(id, "primary", "John", "Smith");

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("unchanged");
    expect(await nameOf(id)).toBe("John Smith");
  });

  it("reports 'no-primary' and writes nothing when there is no primary contact", async () => {
    const id = await makeHousehold("Orphan Household");
    await addContact(id, "dependent", "Kid", "Smith");

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("no-primary");
    expect(await nameOf(id)).toBe("Orphan Household");
  });

  it("checks the lock before the contacts — locked wins over no-primary", async () => {
    const id = await makeHousehold("Smith Family Trust", true);

    const result = await syncHouseholdNameFromContacts(db, id);

    expect(result.outcome).toBe("locked");
  });
});
