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
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
  assertBusinessAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "firm_test", access: "own" }),
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "firm_test", access: "own" }),
}));

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});

// Capture the inserted income row.
const insertedValues: unknown[] = [];
const dbState = { selectCallCount: 0 };

vi.mock("@/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        dbState.selectCallCount++;
        // POST does two selects: client, then scenario.
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
    { id: "inc_test", name: "Business Profit", type: "business" },
  ]);
  const insertValues = vi.fn((vals: unknown) => {
    insertedValues.push(vals);
    return { returning: insertReturning };
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  return {
    db: { select, insert },
  };
});

import { POST } from "../route";
import { assertAccountsInClient, assertBusinessAccountsInClient } from "@/lib/db-scoping";

const ACC_BIZ = "11111111-1111-4111-8111-111111111111";
const ACC_OTHER = "22222222-2222-4222-8222-222222222222";
const ENT_TRUST = "33333333-3333-4333-8333-333333333333";

const buildReq = (body: object): Request =>
  new Request("http://localhost/api/clients/cli_test/incomes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  insertedValues.length = 0;
  dbState.selectCallCount = 0;
  // Reset the mock to its default ok state — the cross-tenant case overrides
  // this with mockResolvedValueOnce, but the default needs to be ok for the
  // other cases.
  vi.mocked(assertAccountsInClient).mockResolvedValue({ ok: true });
  vi.mocked(assertBusinessAccountsInClient).mockResolvedValue({ ok: true });
});

describe("POST /api/clients/[id]/incomes — ownerAccountId", () => {
  it("returns 201 and stores ownerAccountId when set", async () => {
    const res = await POST(
      buildReq({
        type: "business",
        name: "Acme Profit",
        annualAmount: "120000",
        startYear: "2026",
        endYear: "2045",
        growthRate: "0.03",
        owner: "client",
        ownerAccountId: ACC_BIZ,
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(201);
    expect(insertedValues.length).toBe(1);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.ownerAccountId).toBe(ACC_BIZ);
    expect(row.ownerEntityId).toBeNull();
    expect(row.owner).toBe("client");
  });

  it("returns 400 when both ownerEntityId and ownerAccountId are set", async () => {
    const res = await POST(
      buildReq({
        type: "business",
        name: "Conflicted",
        annualAmount: "1000",
        startYear: "2026",
        endYear: "2030",
        growthRate: "0.03",
        owner: "client",
        ownerEntityId: ENT_TRUST,
        ownerAccountId: ACC_BIZ,
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/Cannot set both/i);
    expect(insertedValues.length).toBe(0);
  });

  it("returns 400 when ownerAccountId belongs to another client (tenant check)", async () => {
    vi.mocked(assertAccountsInClient).mockResolvedValueOnce({
      ok: false,
      reason: `Account ${ACC_OTHER} not owned by this client`,
    });

    const res = await POST(
      buildReq({
        type: "business",
        name: "Cross-tenant",
        annualAmount: "1000",
        startYear: "2026",
        endYear: "2030",
        growthRate: "0.03",
        owner: "client",
        ownerAccountId: ACC_OTHER,
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(400);
    // cashAccountId is undefined (not in body); ownerAccountId is the offender.
    // The helper filters out non-string values, so passing undefined is fine.
    expect(vi.mocked(assertAccountsInClient)).toHaveBeenCalledWith("cli_test", [undefined, ACC_OTHER]);
    expect(insertedValues.length).toBe(0);
  });

  it("returns 400 when ownerAccountId points at a non-business account", async () => {
    vi.mocked(assertBusinessAccountsInClient).mockResolvedValueOnce({
      ok: false,
      reason: `Account ${ACC_OTHER} is not a business account`,
    });

    const res = await POST(
      buildReq({
        type: "business",
        name: "Wrong category",
        annualAmount: "1000",
        startYear: "2026",
        endYear: "2030",
        growthRate: "0.03",
        owner: "client",
        ownerAccountId: ACC_OTHER,
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/not a business account/i);
    expect(vi.mocked(assertBusinessAccountsInClient)).toHaveBeenCalledWith("cli_test", [ACC_OTHER]);
    expect(insertedValues.length).toBe(0);
  });

  it("inserts both ownerAccountId and ownerEntityId as null when neither is supplied", async () => {
    const res = await POST(
      buildReq({
        type: "salary",
        name: "Base Salary",
        annualAmount: "100000",
        startYear: "2026",
        endYear: "2045",
        growthRate: "0.03",
        owner: "client",
      }) as never,
      { params: Promise.resolve({ id: "cli_test" }) },
    );

    expect(res.status).toBe(201);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.ownerAccountId).toBeNull();
    expect(row.ownerEntityId).toBeNull();
    expect(row.owner).toBe("client");
  });
});
