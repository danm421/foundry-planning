import { describe, expect, it, vi, beforeEach } from "vitest";

const ctx = vi.fn();
const createRule = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "s-new" }, resourceId: "s-new" }),
);
const updateRule = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "s1" }, resourceId: "s1" }),
);
const deleteRule = vi.fn<(args: Record<string, unknown>) => Promise<Record<string, unknown>>>(
  async () => ({ ok: true, data: { id: "s1" }, resourceId: "s1" }),
);

let ruleRow: Record<string, unknown> | undefined;
let scheduleRows: Record<string, unknown>[];
/** Account reads are served from a QUEUE because ONE request can make two of
 *  them, in a fixed order: `[id]/route`'s gate reads the rule's OWN funding
 *  account first, then — only on a payload that moves `accountId` —
 *  `assertPortalVisibleTarget` reads the NEW target. The last entry repeats, so
 *  a test that cares about a single account sets a single row. */
let accountRows: (Record<string, unknown> | undefined)[];
let accountReads = 0;

// Mocks are forwarded through wrapper arrow functions (not assigned directly)
// so the factory doesn't dereference the vi.fn() consts before their own
// `const` initializers run — vi.mock() calls are hoisted above them, and a
// direct reference there is a TDZ ReferenceError. Matches the pattern in
// src/app/api/portal/expenses/__tests__/route.test.ts.
vi.mock("@/lib/portal/portal-write-context", () => ({
  resolvePortalWriteContext: () => ctx(),
}));
vi.mock("@/lib/clients/savings-rules-writes", () => ({
  createSavingsRuleForClient: (args: Record<string, unknown>) => createRule(args),
  updateSavingsRuleForClient: (args: Record<string, unknown>) => updateRule(args),
  deleteSavingsRuleForClient: (args: Record<string, unknown>) => deleteRule(args),
}));

// THREE tables are read here (savings_rules, accounts, savings_schedule_overrides),
// so the fake has to know which one it is answering for. It branches on the
// PROJECTION the route asks for, not on the table object: drizzle's `table._`
// is a type-only declaration and is `undefined` at runtime, so a branch on
// `table._.name` would silently serve every query the same rows. The three
// selects share no column name.
function rowsFor(shape: Record<string, unknown>): Record<string, unknown>[] {
  if ("category" in shape) {
    const row = accountRows[Math.min(accountReads, accountRows.length - 1)];
    accountReads += 1;
    return row ? [row] : [];
  }
  if ("year" in shape) return scheduleRows;
  return ruleRow ? [ruleRow] : [];
}

vi.mock("@/db", () => ({
  db: {
    select: (shape: Record<string, unknown>) => ({
      // Every link is both awaitable and chainable, so `.where()` and
      // `.where().limit()` both resolve — the schedule query has no `.limit()`.
      from: () => {
        const link = {
          where: () => link,
          limit: async () => rowsFor(shape),
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(shape)).then(onFulfilled, onRejected),
        };
        return link;
      },
    }),
  },
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

const VISIBLE_ACCOUNT = { category: "taxable", isDefaultChecking: false, parentAccountId: null };
/** A 529. Real, advisor-created savings rules fund these — `savingsRules.accountId`
 *  is an unrestricted FK — and the portal deliberately never shows them. */
const HIDDEN_529 = { category: "education_savings", isDefaultChecking: false, parentAccountId: null };
const HIDDEN_POLICY = { category: "life_insurance", isDefaultChecking: false, parentAccountId: null };

function req(body: unknown) {
  return new Request("http://t/api/portal/savings-rules", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const NEW_RULE = { accountId: "acct-1", annualAmount: "500", startYear: 2026, endYear: 2040 };

beforeEach(() => {
  vi.clearAllMocks();
  ctx.mockResolvedValue(OK_CTX);
  ruleRow = { id: "s1", clientId: "c1", accountId: "acct-1", annualPercent: null, contributeMax: false };
  scheduleRows = [];
  accountRows = [VISIBLE_ACCOUNT];
  accountReads = 0;
});

describe("POST /api/portal/savings-rules", () => {
  it("creates a flat-dollar rule against a portal-visible account", async () => {
    const res = await POST(req(NEW_RULE));
    expect(res.status).toBe(201);
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        firmId: "f1",
        actorId: "u1",
        actorKind: "client",
        crossFirmMeta: expect.objectContaining({ via: "portal" }),
      }),
    );
  });

  // actor_kind is a notNull audit_log column that getPortalActivity filters on
  // directly, not jsonb metadata. If a later edit folds actorKind back into
  // crossFirmMeta (or drops it) instead of passing it as its own write-core
  // argument, the write is silently invisible to the advisor's "Recent
  // activity" panel. Reading the raw call argument reddens on BOTH a dropped
  // actorKind and an additionally-folded one.
  it("passes actorKind as its own write-core argument, not folded into crossFirmMeta", async () => {
    await POST(req(NEW_RULE));
    const call = createRule.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("refuses a target account the client cannot see", async () => {
    accountRows = [HIDDEN_POLICY];
    const res = await POST(req(NEW_RULE));
    expect(res.status).toBe(403);
    expect(createRule).not.toHaveBeenCalled();
  });

  it("refuses an account belonging to another client", async () => {
    accountRows = [];
    const res = await POST(req({ ...NEW_RULE, accountId: "gone" }));
    expect(res.status).toBe(400);
    expect(createRule).not.toHaveBeenCalled();
  });

  it("refuses a payload with no accountId at all", async () => {
    const res = await POST(req({ annualAmount: "500", startYear: 2026, endYear: 2040 }));
    expect(res.status).toBe(400);
    expect(createRule).not.toHaveBeenCalled();
  });

  it("propagates a ForbiddenError from the guard as 403 and writes nothing", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    ctx.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(req(NEW_RULE));
    expect(res.status).toBe(403);
    expect(createRule).not.toHaveBeenCalled();
  });
});

describe("PUT /api/portal/savings-rules/[id]", () => {
  it("refuses an IRS-max rule", async () => {
    ruleRow = { ...ruleRow, contributeMax: true };
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(403);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("refuses a percent-of-pay rule", async () => {
    ruleRow = { ...ruleRow, annualPercent: "0.2000" };
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(403);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("refuses a rule carrying a custom schedule", async () => {
    scheduleRows = [{ year: 2030, amount: "1000.00" }];
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(403);
    expect(updateRule).not.toHaveBeenCalled();
  });

  // The rule's OWN funding account has to be re-checked even when the payload
  // does not move it: `assertPortalVisibleTarget` only ever answers for a NEW
  // target. Without a real account map here, a hand-rolled PUT could edit a
  // 529 contribution the portal never renders.
  it("refuses a rule funding a hidden account even when the payload does not move it", async () => {
    accountRows = [HIDDEN_529];
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(403);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("refuses a rule whose funding account no longer resolves", async () => {
    accountRows = [];
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(403);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("404s a row belonging to a different client", async () => {
    ruleRow = { ...ruleRow, clientId: "OTHER" };
    const res = await PUT(req({ annualAmount: "1" }), params("s1"));
    expect(res.status).toBe(404);
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("updates a flat-dollar rule", async () => {
    const res = await PUT(req({ annualAmount: "750" }), params("s1"));
    expect(res.status).toBe(200);
    expect(updateRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: "s1" }));
  });

  it("passes actorKind as its own write-core argument on update, not folded into crossFirmMeta", async () => {
    await PUT(req({ annualAmount: "750" }), params("s1"));
    const call = updateRule.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  it("moves the rule to another portal-visible account", async () => {
    accountRows = [VISIBLE_ACCOUNT, VISIBLE_ACCOUNT];
    const res = await PUT(req({ accountId: "acct-2" }), params("s1"));
    expect(res.status).toBe(200);
    expect(updateRule).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ accountId: "acct-2" }) }),
    );
  });

  // The 403 body distinguishes which gate fired: the rule's own account is
  // visible here, so only the NEW target can be the refusal.
  it("refuses a move onto an account the client cannot see", async () => {
    accountRows = [VISIBLE_ACCOUNT, HIDDEN_529];
    const res = await PUT(req({ accountId: "acct-529" }), params("s1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That account is managed by your advisor" });
    expect(updateRule).not.toHaveBeenCalled();
  });

  it("400s a move onto an account belonging to another client", async () => {
    accountRows = [VISIBLE_ACCOUNT, undefined];
    const res = await PUT(req({ accountId: "gone" }), params("s1"));
    expect(res.status).toBe(400);
    expect(updateRule).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/portal/savings-rules/[id]", () => {
  it("deletes a flat-dollar rule and answers 204", async () => {
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("s1"));
    expect(res.status).toBe(204);
    expect(deleteRule).toHaveBeenCalledWith(expect.objectContaining({ ruleId: "s1" }));
  });

  it("passes actorKind as its own write-core argument on delete, not folded into crossFirmMeta", async () => {
    await DELETE(new Request("http://t", { method: "DELETE" }), params("s1"));
    const call = deleteRule.mock.calls[0][0];
    expect(call.actorKind).toBe("client");
    expect(call.crossFirmMeta).toEqual({ via: "portal" });
  });

  // DELETE never calls `assertPortalVisibleTarget` — there is no target to
  // check — so the rule's own account gate is the ONLY thing standing between
  // a hand-rolled request and a deleted 529 contribution.
  it("refuses to delete a rule funding a hidden account", async () => {
    accountRows = [HIDDEN_529];
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("s1"));
    expect(res.status).toBe(403);
    expect(deleteRule).not.toHaveBeenCalled();
  });

  it("refuses to delete an IRS-max rule", async () => {
    ruleRow = { ...ruleRow, contributeMax: true };
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), params("s1"));
    expect(res.status).toBe(403);
    expect(deleteRule).not.toHaveBeenCalled();
  });
});
