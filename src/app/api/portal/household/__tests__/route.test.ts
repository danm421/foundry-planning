import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

vi.mock("@/lib/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  authErrorResponse: (e: unknown) =>
    e && (e as { name?: string }).name === "ForbiddenError"
      ? { status: 403, body: { error: (e as Error).message } }
      : undefined,
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const updateChain = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateChain(vals) }),
    }),
    select: () => ({
      from: () => ({
        // Thenable so callers can either chain `.limit()` (route.ts's own
        // lookups) or `await` the `.where()` result directly (the
        // sync-household-name queries this route now triggers), matching
        // real Drizzle query-builder chains which support both.
        where: () => ({
          limit: () => selectChain(),
          then: (resolve: (v: unknown) => void) => resolve(selectChain()),
        }),
      }),
    }),
  },
}));

const recordUpdateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (...a: unknown[]) => recordUpdateMock(...a),
}));

import { PUT } from "@/app/api/portal/household/route";

beforeEach(() => {
  resolvePortalClientMock.mockReset();
  requireEditEnabledMock.mockReset();
  updateChain.mockReset();
  selectChain.mockReset();
  recordUpdateMock.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/portal/household", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PUT /api/portal/household", () => {
  it("403s when editing is disabled", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockRejectedValue(
      Object.assign(new Error("disabled"), { name: "ForbiddenError" }),
    );
    const res = await PUT(req({ primary: { firstName: "Jane" } }));
    expect(res.status).toBe(403);
  });

  it("updates primary contact fields", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain
      .mockResolvedValueOnce([{ firmId: "firm-1", crmHouseholdId: "h1" }])
      .mockResolvedValueOnce([{ id: "contact-1", firstName: "Old" }])
      // firstName+lastName both change, so this patch also triggers the
      // household-name sync: lock check, then post-patch contacts.
      .mockResolvedValueOnce([{ name: "Old Name", nameIsCustom: false }])
      .mockResolvedValueOnce([{ role: "primary", firstName: "Jane", lastName: "Doe" }]);
    const res = await PUT(req({ primary: { firstName: "Jane", lastName: "Doe" } }));
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Jane", lastName: "Doe" }),
    );
    expect(recordUpdateMock).toHaveBeenCalled();
  });

  // This file mocks `@/db` outright (see the vi.mock block above) rather than
  // seeding a real household, so — unlike the real-DB round trip in
  // src/lib/crm/__tests__/sync-household-name.test.ts — these two cases pin
  // the wiring: does a name-field patch reach db.update(crmHouseholds) with a
  // recomputed name, gated by the `nameChanged` flag. The `deriveNameFor...`
  // logic itself is exercised against a real household elsewhere.
  it("re-derives the household name when a client renames themself", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain
      .mockResolvedValueOnce([{ firmId: "firm-1", crmHouseholdId: "h1" }]) // client lookup
      .mockResolvedValueOnce([
        { id: "contact-1", firstName: "John", lastName: "Smith", email: null, phone: null },
      ]) // existing primary contact
      .mockResolvedValueOnce([{ name: "John Smith", nameIsCustom: false }]) // household lock check
      .mockResolvedValueOnce([{ role: "primary", firstName: "Jonathan", lastName: "Smith" }]); // post-patch contacts

    const res = await PUT(req({ primary: { firstName: "Jonathan" } }));

    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(expect.objectContaining({ name: "Jonathan Smith" }));
  });

  it("does not touch the name when only contact details change", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain
      .mockResolvedValueOnce([{ firmId: "firm-1", crmHouseholdId: "h1" }]) // client lookup
      .mockResolvedValueOnce([
        { id: "contact-1", firstName: "John", lastName: "Smith", email: null, phone: null },
      ]); // existing primary contact

    const res = await PUT(req({ primary: { phone: "555-0100" } }));

    expect(res.status).toBe(200);
    // Only the contact patch should have written — no household-name sync
    // lookups or writes were triggered by a details-only change.
    expect(selectChain).toHaveBeenCalledTimes(2);
    expect(updateChain).toHaveBeenCalledTimes(1);
    expect(updateChain).toHaveBeenCalledWith(expect.objectContaining({ phone: "555-0100" }));
  });
});
