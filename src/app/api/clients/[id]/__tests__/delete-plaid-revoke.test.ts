// PII audit F3: DELETE /api/clients/[id] must revoke the client's Plaid items
// at the vendor. The DB cascade destroys plaid_items (and the encrypted access
// tokens with them), so without a vendor-side itemRemove the bank connection
// stays live at Plaid forever AND becomes unrevocable after the fact.
//
// Real DB for clients/plaid_items so the collect-before-cascade ordering is
// genuinely exercised; Plaid SDK, crypto, subscription gate, and audit writes
// are mocked (audit is mocked so tests don't leak rows into the dev audit_log).
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
  return { ...actual, recordDelete: vi.fn(), recordUpdate: vi.fn() };
});
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ itemRemove: mocks.itemRemove }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (v: string) => `decrypted-${v}` }));

import { auth } from "@clerk/nextjs/server";
import { DELETE } from "../route";

const ORG = "org_delete_plaid_revoke";
const ADV = "adv_delete_plaid";

function req() {
  return new Request("http://test.local", { method: "DELETE" }) as unknown as
    import("next/server").NextRequest;
}

async function seedClient(): Promise<string> {
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
  return c.id;
}

beforeEach(async () => {
  mocks.itemRemove.mockReset();
  mocks.itemRemove.mockResolvedValue({ request_id: "rq" });
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  // Advisor caller (no staff role) in the owning org.
  vi.mocked(auth).mockResolvedValue({ userId: ADV, orgId: ORG } as never);
});

describe("DELETE /api/clients/[id] — Plaid revoke (audit F3)", () => {
  it("revokes each of the client's Plaid items at the vendor, and only theirs", async () => {
    const target = await seedClient();
    const bystander = await seedClient();
    await db.insert(plaidItems).values([
      { clientId: target, plaidItemId: "item-f3-a", accessToken: "enc-a" },
      { clientId: target, plaidItemId: "item-f3-b", accessToken: "enc-b" },
      { clientId: bystander, plaidItemId: "item-f3-other", accessToken: "enc-other" },
    ]);

    const res = await DELETE(req(), { params: Promise.resolve({ id: target }) });
    expect(res.status).toBe(200);

    expect(mocks.itemRemove).toHaveBeenCalledTimes(2);
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-a" });
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-b" });

    const gone = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, target));
    expect(gone).toHaveLength(0);
    const kept = await db
      .select({ id: plaidItems.id })
      .from(plaidItems)
      .where(eq(plaidItems.clientId, bystander));
    expect(kept).toHaveLength(1);
  });

  it("a Plaid revoke failure does not abort the client delete", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = await seedClient();
    await db
      .insert(plaidItems)
      .values({ clientId: target, plaidItemId: "item-f3-fail", accessToken: "enc-fail" });
    mocks.itemRemove.mockRejectedValue(new Error("Plaid 502"));

    const res = await DELETE(req(), { params: Promise.resolve({ id: target }) });
    expect(res.status).toBe(200);

    const gone = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, target));
    expect(gone).toHaveLength(0);
    errSpy.mockRestore();
  });
});
