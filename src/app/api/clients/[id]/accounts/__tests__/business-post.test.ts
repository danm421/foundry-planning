import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_test"),
  requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "firm_test", userId: "user_test" }),
}));

vi.mock("@/lib/db-scoping", () => ({
  assertEntitiesInClient: vi.fn().mockResolvedValue({ ok: true }),
  assertModelPortfoliosInFirm: vi.fn().mockResolvedValue({ ok: true }),
  assertTickerPortfoliosInFirm: vi.fn().mockResolvedValue({ ok: true }),
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordCreate: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "firm_test", access: "own" }),
}));

vi.mock("@/lib/audit/snapshots/account", () => ({
  toAccountSnapshot: vi.fn().mockResolvedValue({}),
  ACCOUNT_FIELD_LABELS: {},
}));

// Owners pass tenant validation (every fm/entity id "belongs" to the client).
vi.mock("@/lib/ownership", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownership")>("@/lib/ownership");
  return {
    ...actual,
    validateOwnersTenant: vi.fn().mockResolvedValue(null),
  };
});

// Capture the values passed to `accounts.insert`. Owners rows are captured too.
const insertedValues: unknown[] = [];
// Module-scoped counter so each new POST request can reset it.
const dbState = { selectCallCount: 0 };

vi.mock("@/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        dbState.selectCallCount++;
        if (dbState.selectCallCount === 1) {
          return [{ id: "cli_test", firmId: "firm_test" }];
        }
        if (dbState.selectCallCount === 2) {
          return [{ id: "scn_test", clientId: "cli_test", isBaseCase: true }];
        }
        return [];
      }),
    })),
  }));
  const insertReturning = vi.fn().mockResolvedValue([
    { id: "acc_test", name: "Acme LLC", category: "business" },
  ]);
  const insertValues = vi.fn((vals: unknown) => {
    insertedValues.push(vals);
    return { returning: insertReturning };
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = { insert, delete: vi.fn(() => ({ where: vi.fn() })) };
    await cb(tx);
  });
  return {
    db: { select, insert, transaction },
  };
});

import { POST } from "../route";
import { assertAccountsInClient } from "@/lib/db-scoping";

// Valid v4-ish UUIDs (version nibble 4 at pos 14, variant nibble 8 at pos 19).
const FM_CLIENT = "11111111-1111-4111-8111-111111111111";
const FM_SPOUSE = "22222222-2222-4222-8222-222222222222";
const ENT_TRUST = "33333333-3333-4333-8333-333333333333";
const ACC_OTHER = "44444444-4444-4444-8444-444444444444";

const buildReq = (body: object): Request =>
  new Request("http://localhost/api/clients/cli_test/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  insertedValues.length = 0;
  dbState.selectCallCount = 0;
});

describe("POST /api/clients/[id]/accounts — business category", () => {
  it("returns 201 and inserts business columns + account_owners rows", async () => {
    const res = await POST(
      buildReq({
        category: "business",
        name: "Acme LLC",
        businessType: "llc",
        value: 1_000_000,
        basis: 250_000,
        growthRate: 0.05,
        distributionPolicyPercent: 0.4,
        flowMode: "annual",
        businessTaxTreatment: "qbi",
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.6 },
          { kind: "entity", entityId: ENT_TRUST, percent: 0.4 },
        ],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(201);

    // The first inserted row is the account itself.
    expect(insertedValues.length).toBeGreaterThanOrEqual(1);
    const accountRow = insertedValues[0] as Record<string, unknown>;
    expect(accountRow.category).toBe("business");
    expect(accountRow.businessType).toBe("llc");
    expect(accountRow.distributionPolicyPercent).toBe("0.4");
    expect(accountRow.flowMode).toBe("annual");
    expect(accountRow.businessTaxTreatment).toBe("qbi");
    expect(accountRow.parentAccountId).toBeNull();
    // sub_type was derived from businessType.
    expect(accountRow.subType).toBe("llc");

    // Owners rows: exactly two account_owners inserts (the auto-cash account
    // insert also lands in `insertedValues` after the business + owners,
    // so we filter by the owner-row shape rather than slicing positionally).
    const ownerRows = insertedValues.filter(
      (v) => "percent" in (v as Record<string, unknown>),
    ) as Record<string, unknown>[];
    expect(ownerRows.length).toBe(2);
    expect(ownerRows[0].familyMemberId).toBe(FM_CLIENT);
    expect(ownerRows[0].entityId).toBeNull();
    expect(ownerRows[1].familyMemberId).toBeNull();
    expect(ownerRows[1].entityId).toBe(ENT_TRUST);
  });

  it("returns 400 when owners don't sum to 100%", async () => {
    const res = await POST(
      buildReq({
        category: "business",
        name: "Bad Ownership Co",
        businessType: "s_corp",
        value: 100_000,
        basis: 100_000,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.4 },
        ],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/sum to 100%/i);
  });

  it("returns 400 for an unknown businessType (schema rejection)", async () => {
    const res = await POST(
      buildReq({
        category: "business",
        name: "Mystery Co",
        businessType: "co_op",
        value: 0,
        basis: 0,
        owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied subType for business and re-derives from businessType", async () => {
    // Issue 2 regression: a crafted POST with subType: 'checking' must NOT
    // overwrite the derived value. The schema strips/ignores extras, and the
    // route's mapBusinessTypeToSubType call is now unconditional.
    const res = await POST(
      buildReq({
        category: "business",
        name: "Acme LLC",
        businessType: "s_corp",
        subType: "checking", // attacker-supplied; should be ignored
        value: 100_000,
        basis: 100_000,
        owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );
    expect(res.status).toBe(201);
    const accountRow = insertedValues[0] as Record<string, unknown>;
    expect(accountRow.subType).toBe("s_corp");
  });

  it("rejects a parentAccountId that belongs to a different client (tenant check)", async () => {
    // Issue 1 regression: assertAccountsInClient must gate parentAccountId.
    const mocked = vi.mocked(assertAccountsInClient);
    mocked.mockResolvedValueOnce({
      ok: false,
      reason: `Account ${ACC_OTHER} not owned by this client`,
    });

    const res = await POST(
      buildReq({
        category: "business",
        name: "Cross-tenant Co",
        businessType: "llc",
        value: 100_000,
        basis: 100_000,
        parentAccountId: ACC_OTHER,
        owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(400);
    expect(mocked).toHaveBeenCalledWith("cli_test", [ACC_OTHER]);
    // No insert should have happened.
    expect(insertedValues.length).toBe(0);
  });

  it("leaves business columns null when category != 'business' (regression)", async () => {
    const res = await POST(
      buildReq({
        name: "Joint Brokerage",
        category: "taxable",
        subType: "brokerage",
        owner: "joint",
        value: 50_000,
        basis: 30_000,
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );
    expect(res.status).toBe(201);
    const accountRow = insertedValues[0] as Record<string, unknown>;
    expect(accountRow.category).toBe("taxable");
    expect(accountRow.businessType).toBeNull();
    expect(accountRow.distributionPolicyPercent).toBeNull();
    expect(accountRow.businessTaxTreatment).toBeNull();
    expect(accountRow.parentAccountId).toBeNull();
    // flowMode is NOT NULL at the DB layer; defaults to 'annual'.
    expect(accountRow.flowMode).toBe("annual");
  });

  it("auto-provisions a child default-checking cash account on the new business", async () => {
    // A business asset is meaningless without somewhere for its income /
    // expenses / retained earnings to land. The Phase-3 distribution loop
    // looks for a child default-checking cash account; without one, retained
    // earnings have nowhere to live. Auto-create the cash bucket so users
    // don't have to. The auto-created row is system-managed
    // (isDefaultChecking=true) — existing PUT/DELETE guards lock ownership,
    // parenting, category, and deletion.
    const res = await POST(
      buildReq({
        category: "business",
        name: "Acme LLC",
        businessType: "llc",
        value: 1_000_000,
        basis: 250_000,
        owners: [{ kind: "family_member", familyMemberId: FM_CLIENT, percent: 1 }],
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );
    expect(res.status).toBe(201);

    // First insert = business row. Then one owner row. Then the auto-created
    // cash account (the test mocks the insert returning to always come back as
    // acc_test, but we only care about the captured `values` payload here).
    const bizRow = insertedValues[0] as Record<string, unknown>;
    expect(bizRow.category).toBe("business");

    const cashRow = insertedValues.find(
      (v) => (v as Record<string, unknown>).category === "cash",
    ) as Record<string, unknown> | undefined;
    expect(cashRow).toBeDefined();
    expect(cashRow!.subType).toBe("checking");
    expect(cashRow!.isDefaultChecking).toBe(true);
    expect(cashRow!.parentAccountId).toBe("acc_test"); // mock returns this id
    expect(cashRow!.name).toMatch(/Acme LLC/);
  });

});
