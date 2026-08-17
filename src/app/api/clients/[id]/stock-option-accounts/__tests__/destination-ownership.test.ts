// G6 / F50 — `destinationAccountId` accepted any account UUID.
//
// It names the account that receives sold or vested shares. The schema checked
// that it was a UUID and stopped there; nothing checked that it belonged to
// this client. A foreign id sent the whole position into a balance that no
// report of this client's totals ever reads. Every other account reference in
// the app goes through `assertAccountsInClient`; this one did not.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_test"),
  requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "firm_test", userId: "user_test" }),
}));

vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
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

const inserted: unknown[] = [];
const updated: unknown[] = [];

vi.mock("@/db", () => {
  // POST reads the base-case scenario then the family members; PUT reads the
  // target account then the family members. A single row of each shape covers
  // both without the test caring about call order.
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => [
        { id: "scn_test", clientId: "cli_test", isBaseCase: true, category: "stock_options", role: "client" },
      ]),
      leftJoin: vi.fn(() => ({ where: vi.fn(() => []) })),
    })),
  }));
  const insertValues = vi.fn((vals: unknown) => {
    inserted.push(vals);
    return {
      returning: vi.fn().mockResolvedValue([{ id: "acct_new", name: "Acme Stock Options" }]),
      then: (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r),
    };
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  const update = vi.fn(() => ({
    set: vi.fn((vals: unknown) => {
      updated.push(vals);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  const del = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const tx = { select, insert, update, delete: del };
  const transaction = vi.fn(async (cb: (t: unknown) => unknown) => cb(tx));
  return { db: { select, insert, update, delete: del, transaction } };
});

import { POST } from "../route";
import { PUT } from "../[accountId]/route";
import { assertAccountsInClient } from "@/lib/db-scoping";

const FOREIGN = "99999999-9999-4999-8999-999999999999";
const MINE = "11111111-1111-4111-8111-111111111111";

const CREATE_BODY = { name: "Acme Stock Options", owner: "client" as const };

function req(body: object): NextRequestLike {
  return new Request("http://localhost/api/clients/cli_test/stock-option-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequestLike;
}

// The handlers are typed for NextRequest but only use `.json()`.
type NextRequestLike = Parameters<typeof POST>[0];

const postParams = { params: Promise.resolve({ id: "cli_test" }) };
const putParams = { params: Promise.resolve({ id: "cli_test", accountId: "acct_so" }) };

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  vi.mocked(assertAccountsInClient).mockResolvedValue({ ok: true });
});

describe("POST /stock-option-accounts — destinationAccountId ownership (F50)", () => {
  it("checks the destination against this client", async () => {
    await POST(req({ ...CREATE_BODY, destinationAccountId: MINE }), postParams);
    expect(assertAccountsInClient).toHaveBeenCalledWith("cli_test", [MINE]);
  });

  it("rejects an account this client does not own", async () => {
    vi.mocked(assertAccountsInClient).mockResolvedValue({
      ok: false,
      reason: `Account ${FOREIGN} not owned by this client`,
    });

    const res = await POST(req({ ...CREATE_BODY, destinationAccountId: FOREIGN }), postParams);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Account ${FOREIGN} not owned by this client` });
    // Nothing was written.
    expect(inserted).toEqual([]);
  });

  it("still creates the account when the destination is owned", async () => {
    // The control: without it, the 400 above could come from anywhere.
    const res = await POST(req({ ...CREATE_BODY, destinationAccountId: MINE }), postParams);
    expect(res.status).toBe(201);
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("leaves a body with no destination alone", async () => {
    const res = await POST(req(CREATE_BODY), postParams);
    expect(res.status).toBe(201);
    // `assertAccountsInClient` short-circuits on an empty list, so it is still
    // called — with nothing to check.
    expect(assertAccountsInClient).toHaveBeenCalledWith("cli_test", [undefined]);
  });
});

describe("PUT /stock-option-accounts/[accountId] — destinationAccountId ownership (F50)", () => {
  it("rejects an account this client does not own", async () => {
    vi.mocked(assertAccountsInClient).mockResolvedValue({
      ok: false,
      reason: `Account ${FOREIGN} not owned by this client`,
    });

    const res = await PUT(req({ destinationAccountId: FOREIGN }), putParams);

    expect(res.status).toBe(400);
    expect(updated).toEqual([]);
  });

  it("still updates when the destination is owned", async () => {
    const res = await PUT(req({ destinationAccountId: MINE }), putParams);
    expect(res.status).toBe(200);
    expect(assertAccountsInClient).toHaveBeenCalledWith("cli_test", [MINE]);
    expect(updated.some((u) => (u as Record<string, unknown>).destinationAccountId === MINE)).toBe(true);
  });
});
