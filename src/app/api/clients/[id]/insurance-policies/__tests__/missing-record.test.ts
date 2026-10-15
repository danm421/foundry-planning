// src/app/api/clients/[id]/insurance-policies/__tests__/missing-record.test.ts
/**
 * A policy create for a client with no base case, and a policy update for a
 * policy the client doesn't have, answer 404 BEFORE they read the request body
 * — so a body that isn't JSON still gets the 404, as it did before the writes
 * moved into their write core (Plan 4, Task 9).
 *
 * Mocked at the db / auth seams: every read finds nothing, and the one read
 * each route makes is its record check (the core is never reached).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (res: (rows: unknown[]) => unknown) => res([]);
    return c;
  };
  return { select: vi.fn(() => chain()) };
});

vi.mock("@/db", () => ({
  db: { select: h.select, transaction: async () => { throw new Error("reached the write"); } },
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "firm_1") }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: "firm_1", access: "own" })),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(async () => undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "../route";
import { PATCH } from "../[policyId]/route";

const CLIENT = "00000000-0000-4000-8000-0000000000cc";
const MISSING = "00000000-0000-4000-8000-0000000000dd";
const notJson = (method: string) => new Request("http://localhost/x", { method, body: "{not json" }) as never;

beforeEach(() => {
  h.select.mockClear();
});

describe("a policy write for a record the client doesn't have", () => {
  it("POST answers 404 for a client with no base case without reading the body", async () => {
    const res = await POST(notJson("POST"), { params: Promise.resolve({ id: CLIENT }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Client not found" });
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("PATCH answers 404 for a policy the client doesn't have without reading the body", async () => {
    const res = await PATCH(notJson("PATCH"), { params: Promise.resolve({ id: CLIENT, policyId: MISSING }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Policy not found" });
    expect(h.select).toHaveBeenCalledTimes(1);
  });
});
