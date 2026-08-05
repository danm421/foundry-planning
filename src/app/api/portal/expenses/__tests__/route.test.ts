import { describe, expect, it, vi, beforeEach } from "vitest";

const ctx = vi.fn();
const createExpense = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "new-1" }, resourceId: "new-1" }),
);
const updateExpense = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "e1" }, resourceId: "e1" }),
);
const deleteExpense = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "e1" }, resourceId: "e1" }),
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
vi.mock("@/lib/clients/expenses-writes", () => ({
  createExpenseForClient: (args: Record<string, unknown>) => createExpense(args),
  updateExpenseForClient: (args: Record<string, unknown>) => updateExpense(args),
  deleteExpenseForClient: (args: Record<string, unknown>) => deleteExpense(args),
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
  return new Request("http://t/api/portal/expenses", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  ctx.mockResolvedValue(OK_CTX);
  dbRow = { id: "e1", clientId: "c1", source: "manual", ownerEntityId: null, ownerAccountId: null };
});

describe("POST /api/portal/expenses", () => {
  it("creates through the shared write-core with portal audit provenance", async () => {
    const res = await POST(req({ type: "other", name: "Vacation", startYear: 2026, endYear: 2040 }));
    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(
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
    await POST(req({ type: "other", name: "Vacation", startYear: 2026, endYear: 2040 }));
    const call = createExpense.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("propagates a ForbiddenError from the guard as 403 and writes nothing", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    ctx.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(req({ type: "other", name: "Vacation", startYear: 2026, endYear: 2040 }));
    expect(res.status).toBe(403);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("creates a goal — an expense carrying isGoal — through the same route", async () => {
    const res = await POST(req({ type: "other", name: "New boat", startYear: 2030, endYear: 2030, isGoal: true }));
    expect(res.status).toBe(201);
    expect(createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ isGoal: true }) }),
    );
  });
});

describe("PUT /api/portal/expenses/[id]", () => {
  it("refuses a synthesized policy premium with 403", async () => {
    dbRow = { id: "e1", clientId: "c1", source: "policy", ownerEntityId: null, ownerAccountId: null };
    const res = await PUT(req({ name: "hack" }), params("e1"));
    expect(res.status).toBe(403);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("refuses an entity-owned expense with 403", async () => {
    dbRow = { id: "e1", clientId: "c1", source: "manual", ownerEntityId: "ent-1", ownerAccountId: null };
    const res = await PUT(req({ name: "hack" }), params("e1"));
    expect(res.status).toBe(403);
  });

  it("404s a row belonging to a different client", async () => {
    dbRow = { id: "e1", clientId: "OTHER", source: "manual", ownerEntityId: null, ownerAccountId: null };
    const res = await PUT(req({ name: "x" }), params("e1"));
    expect(res.status).toBe(404);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("updates an ordinary expense", async () => {
    const res = await PUT(req({ name: "New name" }), params("e1"));
    expect(res.status).toBe(200);
    expect(updateExpense).toHaveBeenCalledWith(expect.objectContaining({ expenseId: "e1" }));
  });

  // Same regression class as the POST discriminator above, at the PUT call
  // site: a fold of actorKind into crossFirmMeta here would leave every other
  // PUT assertion green while making a client's edit invisible to
  // getPortalActivity's actor_kind filter.
  it("passes actorKind as its own write-core argument on update, not folded into crossFirmMeta", async () => {
    await PUT(req({ name: "New name" }), params("e1"));
    const call = updateExpense.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });
});

describe("DELETE /api/portal/expenses/[id]", () => {
  it("deletes an ordinary expense and answers 204", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("e1"));
    expect(res.status).toBe(204);
    expect(deleteExpense).toHaveBeenCalledWith(expect.objectContaining({ expenseId: "e1" }));
  });

  // Same regression class as the POST discriminator above, at the DELETE call
  // site: a fold of actorKind into crossFirmMeta here would leave every other
  // DELETE assertion green while making a client's delete invisible to
  // getPortalActivity's actor_kind filter.
  it("passes actorKind as its own write-core argument on delete, not folded into crossFirmMeta", async () => {
    await DELETE(new Request("http://t", { method: "DELETE" }), params("e1"));
    const call = deleteExpense.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("lets the write-core answer for a default living-expense delete", async () => {
    // The route must NOT pre-empt this with its own guard — the write-core owns
    // the rule and its wording, so advisor and client get the same message.
    deleteExpense.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: "Default living-expense rows cannot be deleted.",
    });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("e1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Default living-expense rows cannot be deleted." });
    expect(deleteExpense).toHaveBeenCalled();
  });
});
