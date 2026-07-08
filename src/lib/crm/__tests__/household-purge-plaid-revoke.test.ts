// PII audit F3 (depth fix): purgeCrmHouseholdById deletes the planning client,
// cascading plaid_items away — so the revoke must live INSIDE the primitive.
// Its callers (household permanent-delete endpoint, trash-purge cron, firm
// purge) all inherit it; without this, those paths strand live bank
// connections at Plaid with the tokens destroyed. Real DB; Plaid SDK, crypto,
// and audit writes are mocked.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, plaidItems } from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ itemRemove: vi.fn() }));

vi.mock("@/lib/audit/record-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit/record-helpers")>();
  return { ...actual, recordDelete: vi.fn() };
});
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ itemRemove: mocks.itemRemove }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (v: string) => `decrypted-${v}` }));

import { purgeCrmHouseholdById } from "../households";

const FIRM = "test-firm-purge-plaid";

async function seedHouseholdWithClient(): Promise<{ hhId: string; clientId: string }> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: "u", name: "Purge Plaid Test", status: "active" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: FIRM,
      advisorId: "u",
      crmHouseholdId: hh.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  return { hhId: hh.id, clientId: c.id };
}

beforeEach(async () => {
  mocks.itemRemove.mockReset();
  mocks.itemRemove.mockResolvedValue({ request_id: "rq" });
  await db.delete(clients).where(eq(clients.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

describe("purgeCrmHouseholdById — Plaid revoke (audit F3)", () => {
  it("revokes the planning client's Plaid items at the vendor", async () => {
    const { hhId, clientId } = await seedHouseholdWithClient();
    await db.insert(plaidItems).values([
      { clientId, plaidItemId: "item-hh-purge-a", accessToken: "enc-hh-a" },
      { clientId, plaidItemId: "item-hh-purge-b", accessToken: "enc-hh-b" },
    ]);

    await purgeCrmHouseholdById(hhId, FIRM, true);

    expect(mocks.itemRemove).toHaveBeenCalledTimes(2);
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-hh-a" });
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-hh-b" });
    const gone = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, hhId));
    expect(gone).toHaveLength(0);
  });

  it("a Plaid revoke failure does not abort the purge", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hhId, clientId } = await seedHouseholdWithClient();
    await db
      .insert(plaidItems)
      .values({ clientId, plaidItemId: "item-hh-purge-fail", accessToken: "enc-hh-fail" });
    mocks.itemRemove.mockRejectedValue(new Error("Plaid 502"));

    await expect(purgeCrmHouseholdById(hhId, FIRM, true)).resolves.toBeUndefined();

    const gone = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, hhId));
    expect(gone).toHaveLength(0);
    errSpy.mockRestore();
  });
});
