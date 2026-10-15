// src/app/api/clients/[id]/__tests__/trust-update-missing-record.test.ts
/**
 * A trust update answers 404 for a trust the client doesn't have BEFORE it
 * reads the request body — so a body that isn't JSON still gets the 404, as it
 * did before the update moved into its write core (Plan 4, Task 11).
 *
 * Mocked at the db / auth seams: every read finds nothing, and the one read
 * the route makes is the record check (the core is never reached).
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
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: vi.fn(async () => ({ orgId: "firm_1", userId: "user_1" })),
  requireOrgId: vi.fn(async () => "firm_1"),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: "firm_1", access: "own" })),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(async () => undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { PUT as putEntity } from "../entities/[entityId]/route";
import { PATCH as patchRevocableTrust } from "../revocable-trusts/[trustId]/route";

const CLIENT = "00000000-0000-4000-8000-0000000000cc";
const MISSING = "00000000-0000-4000-8000-0000000000dd";
const notJson = (method: string) => new Request("http://localhost/x", { method, body: "{not json" }) as never;

beforeEach(() => {
  h.select.mockClear();
});

describe("a trust update for a trust the client doesn't have", () => {
  it("PUT /entities/[entityId] answers 404 without reading the body", async () => {
    const res = await putEntity(notJson("PUT"), { params: Promise.resolve({ id: CLIENT, entityId: MISSING }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Entity not found" });
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("PATCH /revocable-trusts/[trustId] answers 404 without reading the body", async () => {
    const res = await patchRevocableTrust(notJson("PATCH"), { params: Promise.resolve({ id: CLIENT, trustId: MISSING }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Trust not found" });
    expect(h.select).toHaveBeenCalledTimes(1);
  });
});
