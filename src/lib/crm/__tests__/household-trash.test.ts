import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("test-firm-trash") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "test-firm-trash" }),
  };
});

import {
  softDeleteCrmHousehold,
  restoreCrmHousehold,
  purgeCrmHousehold,
  listCrmHouseholds,
} from "../households";

const FIRM = "test-firm-trash";

describe("household trash lifecycle", () => {
  let hhId: string;
  let clientId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: "u", name: "Trash Test", status: "active" })
      .returning();
    hhId = hh.id;
    await db.insert(crmHouseholdContacts).values({
      householdId: hhId,
      role: "primary",
      firstName: "T",
      lastName: "T",
    });
    const [c] = await db
      .insert(clients)
      .values({
        firmId: FIRM,
        advisorId: "u",
        retirementAge: 65,
        planEndAge: 95,
        crmHouseholdId: hhId,
      })
      .returning();
    clientId = c.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, clientId)).catch(() => {});
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, hhId)).catch(() => {});
  });

  it("soft-delete hides from the default list and shows in the deleted list", async () => {
    await softDeleteCrmHousehold(hhId, "user_test");
    const live = await listCrmHouseholds({});
    expect(live.find((h) => h.id === hhId)).toBeUndefined();
    const trashed = await listCrmHouseholds({ deleted: true });
    expect(trashed.find((h) => h.id === hhId)).toBeDefined();
  });

  it("restore brings it back and the planning client survived", async () => {
    await restoreCrmHousehold(hhId);
    const live = await listCrmHouseholds({});
    expect(live.find((h) => h.id === hhId)).toBeDefined();
    const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(c).toBeDefined();
  });

  it("purge removes household + planning client in RESTRICT-safe order", async () => {
    await softDeleteCrmHousehold(hhId, "user_test");
    await purgeCrmHousehold(hhId);
    const [c] = await db.select().from(clients).where(eq(clients.id, clientId));
    expect(c).toBeUndefined();
    const [h] = await db.select().from(crmHouseholds).where(eq(crmHouseholds.id, hhId));
    expect(h).toBeUndefined();
  });
});
