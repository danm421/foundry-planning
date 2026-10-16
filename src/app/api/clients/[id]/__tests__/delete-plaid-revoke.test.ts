// PII audit F3: deleting a client must still revoke its Plaid items at the
// vendor. DELETE /api/clients/[id] now moves the client's household to the
// Trash, so the client and its bank connections stay intact (restorable) until
// the Trash purge, which revokes them before the cascade destroys plaid_items
// (and the encrypted access tokens with them). Without that vendor-side
// itemRemove the bank connection stays live at Plaid forever AND becomes
// unrevocable after the fact.
//
// Real DB for clients/plaid_items so the trash → purge hand-off is genuinely
// exercised; Plaid SDK, crypto, subscription gate, and audit writes are mocked
// (audit is mocked so tests don't leak rows into the dev audit_log).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, plaidItems } from "@/db/schema";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ itemRemove: vi.fn() }));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_delete_plaid_revoke") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, recordAudit: vi.fn(), recordDelete: vi.fn(), recordUpdate: vi.fn() };
});
vi.mock("@/lib/audit/record-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit/record-helpers")>();
  return { ...actual, recordDelete: vi.fn() };
});
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ itemRemove: mocks.itemRemove }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (v: string) => `decrypted-${v}` }));

import { auth } from "@clerk/nextjs/server";
import { purgeCrmHouseholdById } from "@/lib/crm/households";
import { DELETE } from "../route";

const ORG = "org_delete_plaid_revoke";
const ADV = "adv_delete_plaid";

function req() {
  return new Request("http://test.local", { method: "DELETE" }) as unknown as
    import("next/server").NextRequest;
}

async function seedClient(): Promise<{ id: string; householdId: string }> {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: ADV, name: "HH" })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: ORG,
      advisorId: ADV,
      crmHouseholdId: h.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning();
  return { id: c.id, householdId: h.id };
}

beforeEach(async () => {
  mocks.itemRemove.mockReset();
  mocks.itemRemove.mockResolvedValue({ request_id: "rq" });
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  // A firm admin of the owning org — the only caller who may delete a client.
  vi.mocked(auth).mockResolvedValue({ userId: ADV, orgId: ORG, orgRole: "org:admin" } as never);
});

describe("DELETE /api/clients/[id] — Plaid revoke (audit F3)", () => {
  it("moves the client to the Trash with its bank connections intact", async () => {
    const target = await seedClient();
    await db
      .insert(plaidItems)
      .values({ clientId: target.id, plaidItemId: "item-f3-trash", accessToken: "enc-trash" });

    const res = await DELETE(req(), { params: Promise.resolve({ id: target.id }) });
    expect(res.status).toBe(200);

    const [hh] = await db
      .select({ deletedAt: crmHouseholds.deletedAt })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, target.householdId));
    expect(hh.deletedAt).not.toBeNull();
    const kept = await db
      .select({ id: plaidItems.id })
      .from(plaidItems)
      .where(eq(plaidItems.clientId, target.id));
    expect(kept).toHaveLength(1);
    expect(mocks.itemRemove).not.toHaveBeenCalled();
  });

  it("the Trash purge then revokes each of the client's Plaid items, and only theirs", async () => {
    const target = await seedClient();
    const bystander = await seedClient();
    await db.insert(plaidItems).values([
      { clientId: target.id, plaidItemId: "item-f3-a", accessToken: "enc-a" },
      { clientId: target.id, plaidItemId: "item-f3-b", accessToken: "enc-b" },
      { clientId: bystander.id, plaidItemId: "item-f3-other", accessToken: "enc-other" },
    ]);

    const res = await DELETE(req(), { params: Promise.resolve({ id: target.id }) });
    expect(res.status).toBe(200);
    await purgeCrmHouseholdById(target.householdId, ORG);

    expect(mocks.itemRemove).toHaveBeenCalledTimes(2);
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-a" });
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-b" });

    const gone = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, target.id));
    expect(gone).toHaveLength(0);
    const kept = await db
      .select({ id: plaidItems.id })
      .from(plaidItems)
      .where(eq(plaidItems.clientId, bystander.id));
    expect(kept).toHaveLength(1);
  });
});
