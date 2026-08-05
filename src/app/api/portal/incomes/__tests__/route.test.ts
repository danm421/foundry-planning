import { describe, expect, it, vi, beforeEach } from "vitest";

const ctx = vi.fn();
const createIncome = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "new-1" }, resourceId: "new-1" }),
);
const updateIncome = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "i1" }, resourceId: "i1" }),
);
const deleteIncome = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "i1" }, resourceId: "i1" }),
);
let dbRow: Record<string, unknown> | undefined;

// Mocks are forwarded through wrapper arrow functions (not assigned
// directly) so the factory doesn't dereference the vi.fn() consts before
// their own `const` initializers run — vi.mock() calls are hoisted above
// them, and a direct reference there is a TDZ ReferenceError. Matches the
// pattern in src/app/api/portal/liabilities/[id]/__tests__/route.test.ts.
vi.mock("@/lib/portal/portal-write-context", () => ({
  resolvePortalWriteContext: () => ctx(),
}));
vi.mock("@/lib/clients/incomes-writes", () => ({
  createIncomeForClient: (args: Record<string, unknown>) => createIncome(args),
  updateIncomeForClient: (args: Record<string, unknown>) => updateIncome(args),
  deleteIncomeForClient: (args: Record<string, unknown>) => deleteIncome(args),
}));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (dbRow ? [dbRow] : []) }) }) }) },
}));

import { POST } from "../route";
import { PUT, DELETE } from "../[id]/route";

// actorKind is a SEPARATE top-level field on the resolved context, not folded
// into auditMeta — see src/lib/portal/portal-write-context.ts. auditMeta
// carries only the jsonb-metadata provenance ({ via: "portal" }, plus
// viaPreview when mode === "advisor").
const OK_CTX = {
  clientId: "c1",
  firmId: "f1",
  actorId: "u1",
  mode: "client" as const,
  actorKind: "client" as const,
  auditMeta: { via: "portal" },
};

function req(body: unknown) {
  return new Request("http://t/api/portal/incomes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  ctx.mockResolvedValue(OK_CTX);
  dbRow = { id: "i1", clientId: "c1", source: "manual", type: "salary", ownerEntityId: null, ownerAccountId: null };
});

describe("POST /api/portal/incomes", () => {
  it("creates through the shared write-core with portal audit provenance", async () => {
    const res = await POST(req({ type: "salary", name: "Job", startYear: 2026, endYear: 2040 }));
    expect(res.status).toBe(201);
    expect(createIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        firmId: "f1",
        actorId: "u1",
        actorKind: "client",
        crossFirmMeta: expect.objectContaining({ via: "portal" }),
      }),
    );
  });

  // Task 3 fixed a real bug: actor_kind is a notNull audit_log column that
  // getPortalActivity filters on directly, not jsonb metadata. If a later
  // edit folds actorKind back into crossFirmMeta (or drops it) instead of
  // passing it as its own write-core argument, the write is silently
  // invisible to the advisor's "Recent activity" panel. This test reddens on
  // exactly that regression, independent of the assertion above.
  it("passes actorKind as its own write-core argument, not folded into crossFirmMeta", async () => {
    await POST(req({ type: "salary", name: "Job", startYear: 2026, endYear: 2040 }));
    const call = createIncome.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("propagates a ForbiddenError from the guard as 403 and writes nothing", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    ctx.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(req({ type: "salary", name: "Job", startYear: 2026, endYear: 2040 }));
    expect(res.status).toBe(403);
    expect(createIncome).not.toHaveBeenCalled();
  });
});

describe("PUT /api/portal/incomes/[id]", () => {
  it("refuses a social-security row with 403 — re-derived from the DB, not the body", async () => {
    dbRow = { id: "i1", clientId: "c1", source: "manual", type: "social_security", ownerEntityId: null, ownerAccountId: null };
    const res = await PUT(req({ name: "hack" }), params("i1"));
    expect(res.status).toBe(403);
    expect(updateIncome).not.toHaveBeenCalled();
  });

  it("refuses a synthesized policy income with 403", async () => {
    dbRow = { id: "i1", clientId: "c1", source: "policy", type: "other", ownerEntityId: null, ownerAccountId: null };
    const res = await PUT(req({ name: "hack" }), params("i1"));
    expect(res.status).toBe(403);
  });

  it("refuses an entity-owned income with 403", async () => {
    dbRow = { id: "i1", clientId: "c1", source: "manual", type: "other", ownerEntityId: "ent-1", ownerAccountId: null };
    const res = await PUT(req({ name: "hack" }), params("i1"));
    expect(res.status).toBe(403);
  });

  it("404s a row belonging to a different client", async () => {
    dbRow = { id: "i1", clientId: "OTHER", source: "manual", type: "salary", ownerEntityId: null, ownerAccountId: null };
    const res = await PUT(req({ name: "x" }), params("i1"));
    expect(res.status).toBe(404);
    expect(updateIncome).not.toHaveBeenCalled();
  });

  it("updates an ordinary income", async () => {
    const res = await PUT(req({ name: "New name" }), params("i1"));
    expect(res.status).toBe(200);
    expect(updateIncome).toHaveBeenCalledWith(expect.objectContaining({ incomeId: "i1" }));
  });

  // Same regression class as the POST discriminator above, at the PUT call
  // site: a fold of actorKind into crossFirmMeta here would leave every other
  // PUT assertion green while making a client's edit invisible to
  // getPortalActivity's actor_kind filter.
  it("passes actorKind as its own write-core argument on update, not folded into crossFirmMeta", async () => {
    await PUT(req({ name: "New name" }), params("i1"));
    const call = updateIncome.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });
});

describe("DELETE /api/portal/incomes/[id]", () => {
  it("deletes an ordinary income and answers 204", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("i1"));
    expect(res.status).toBe(204);
    expect(deleteIncome).toHaveBeenCalledWith(expect.objectContaining({ incomeId: "i1" }));
  });

  // Same regression class as the POST discriminator above, at the DELETE call
  // site: a fold of actorKind into crossFirmMeta here would leave every other
  // DELETE assertion green while making a client's delete invisible to
  // getPortalActivity's actor_kind filter.
  it("passes actorKind as its own write-core argument on delete, not folded into crossFirmMeta", async () => {
    await DELETE(new Request("http://t", { method: "DELETE" }), params("i1"));
    const call = deleteIncome.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("refuses to delete a social-security row", async () => {
    dbRow = { id: "i1", clientId: "c1", source: "manual", type: "social_security", ownerEntityId: null, ownerAccountId: null };
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("i1"));
    expect(res.status).toBe(403);
    expect(deleteIncome).not.toHaveBeenCalled();
  });
});
