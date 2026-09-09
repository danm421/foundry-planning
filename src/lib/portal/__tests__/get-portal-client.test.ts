import { describe, it, expect, vi, beforeEach } from "vitest";

const { listMock, cookieMock, legacyMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  cookieMock: vi.fn(),
  legacyMock: vi.fn(),
}));

vi.mock("@/lib/portal/bindings", () => ({ listBindingsForUser: listMock }));
vi.mock("next/headers", () => ({ cookies: cookieMock }));
vi.mock("@/lib/portal/legacy-binding", () => ({ legacyPortalClientRef: legacyMock }));

import {
  getPortalClientRef,
  getPortalClientId,
  getPortalBindings,
} from "@/lib/portal/get-portal-client";

function binding(
  clientId: string,
  acceptedAt: string,
  status: "active" | "pending" | "declined" | "revoked" = "active",
  firm = { firmId: "org_1", advisorId: "user_a" },
) {
  return {
    bindingId: `b-${clientId}`,
    clientId,
    firmId: firm.firmId,
    advisorId: firm.advisorId,
    acceptedAt: new Date(acceptedAt),
    status,
  };
}

beforeEach(() => {
  listMock.mockReset();
  legacyMock.mockReset();
  cookieMock.mockReset();
  cookieMock.mockResolvedValue({ get: () => undefined });
});

// Every case uses its OWN clerkUserId. `getPortalClientRef` is wrapped in
// React.cache, and while that degrades to a pass-through outside a React
// request scope (measured: two calls with the same argument invoke the inner
// function twice under vitest), a shared argument would silently turn into
// cross-test memoization the day that stops being true.
describe("getPortalClientRef", () => {
  it("returns null for a user with no binding rows and no legacy row", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue(null);
    expect(await getPortalClientRef("user_none")).toBeNull();
  });

  it("resolves the single binding a normal client holds", async () => {
    listMock.mockResolvedValue([binding("client-1", "2026-01-01T00:00:00Z")]);
    const ref = await getPortalClientRef("user_single");
    expect(ref).toEqual({ id: "client-1", firmId: "org_1", advisorId: "user_a" });
    expect(legacyMock).not.toHaveBeenCalled();
  });

  it("uses the cookie to choose between two bindings", async () => {
    listMock.mockResolvedValue([
      binding("client-new", "2026-06-01T00:00:00Z"),
      binding("client-old", "2026-01-01T00:00:00Z"),
    ]);
    cookieMock.mockResolvedValue({ get: () => ({ value: "client-old" }) });
    expect((await getPortalClientRef("user_two"))?.id).toBe("client-old");
  });

  it("falls back to the newest acceptance with no cookie", async () => {
    listMock.mockResolvedValue([
      binding("client-new", "2026-06-01T00:00:00Z"),
      binding("client-old", "2026-01-01T00:00:00Z"),
    ]);
    expect((await getPortalClientRef("user_nocookie"))?.id).toBe("client-new");
  });

  it("ignores a cookie naming a household the user does not hold", async () => {
    listMock.mockResolvedValue([binding("client-mine", "2026-01-01T00:00:00Z")]);
    cookieMock.mockResolvedValue({ get: () => ({ value: "client-theirs" }) });
    expect((await getPortalClientRef("user_forged"))?.id).toBe("client-mine");
  });

  // firmId and advisorId are what `requireClientPortalAccess` authorizes
  // against. With a single-firm fixture, a mutation that returned
  // `bindings[0].firmId` next to the SELECTED binding's clientId would pass
  // every other test in this file while checking the active household against
  // another firm's entitlement.
  it("takes id, firmId and advisorId all from the SELECTED binding", async () => {
    listMock.mockResolvedValue([
      binding("client-acme", "2026-06-01T00:00:00Z", "active", {
        firmId: "org_acme",
        advisorId: "adv_acme",
      }),
      binding("client-globex", "2026-01-01T00:00:00Z", "active", {
        firmId: "org_globex",
        advisorId: "adv_globex",
      }),
    ]);
    cookieMock.mockResolvedValue({ get: () => ({ value: "client-globex" }) });

    expect(await getPortalClientRef("user_twofirms")).toEqual({
      id: "client-globex",
      firmId: "org_globex",
      advisorId: "adv_globex",
    });
  });

  it("falls back to the legacy column ONLY when there are no binding rows", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });
    expect((await getPortalClientRef("user_legacy"))?.id).toBe("client-legacy");
  });

  it("does not consult the legacy column when an active binding exists", async () => {
    listMock.mockResolvedValue([binding("client-1", "2026-01-01T00:00:00Z")]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });
    expect((await getPortalClientRef("user_bound"))?.id).toBe("client-1");
    expect(legacyMock).not.toHaveBeenCalled();
  });

  // THE revoke invariant. `clients.clerk_user_id` is still written during
  // Deploy 1 and revoking deliberately does not clear it, so a fallback
  // condition of "no ACTIVE bindings" would read that column and hand the
  // household straight back — making every revoke path a no-op.
  it("returns null for a REVOKED binding instead of resurrecting it from the legacy column", async () => {
    listMock.mockResolvedValue([binding("client-gone", "2026-01-01T00:00:00Z", "revoked")]);
    legacyMock.mockResolvedValue({ id: "client-gone", firmId: "org_1", advisorId: "user_a" });

    expect(await getPortalClientRef("user_revoked")).toBeNull();
    expect(legacyMock).not.toHaveBeenCalled();
  });

  // A `pending` or `declined` row is NOT history. It is an unanswered or a
  // refused proposal from a firm that never had access, and it says nothing
  // about whether this login's EXISTING household made it into the table. Let
  // one suppress the fallback and any advisor at any firm could evict a
  // mid-deploy client from the household they already had, permanently, just
  // by asking them for access — nothing purges an expired pending row, and
  // declining leaves a `declined` one.
  it("falls back to the legacy column when the only row is a PENDING request", async () => {
    listMock.mockResolvedValue([binding("client-asked", "2026-01-01T00:00:00Z", "pending")]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });

    expect((await getPortalClientRef("user_pending"))?.id).toBe("client-legacy");
  });

  it("falls back to the legacy column when the only row is DECLINED", async () => {
    listMock.mockResolvedValue([binding("client-said-no", "2026-02-01T00:00:00Z", "declined")]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });

    expect((await getPortalClientRef("user_declined"))?.id).toBe("client-legacy");
  });

  it("returns null for a pending-only user who has no legacy row either", async () => {
    listMock.mockResolvedValue([binding("client-asked", "2026-01-01T00:00:00Z", "pending")]);
    legacyMock.mockResolvedValue(null);

    expect(await getPortalClientRef("user_pending_nolegacy")).toBeNull();
  });

  // The hard constraint, restated for the mixed case: a pending row must not
  // launder a revoked one past the gate. Revoking does not clear the legacy
  // column, so falling through here would hand back the household the advisor
  // just removed.
  it("still refuses the legacy column when a REVOKED row sits beside a pending one", async () => {
    listMock.mockResolvedValue([
      binding("client-asked", "2026-03-01T00:00:00Z", "pending"),
      binding("client-gone", "2026-01-01T00:00:00Z", "revoked"),
    ]);
    legacyMock.mockResolvedValue({ id: "client-gone", firmId: "org_1", advisorId: "user_a" });

    expect(await getPortalClientRef("user_pending_and_revoked")).toBeNull();
    expect(legacyMock).not.toHaveBeenCalled();
  });

  it("selects the active binding even when a revoked one is more recent", async () => {
    listMock.mockResolvedValue([
      binding("client-gone", "2026-06-01T00:00:00Z", "revoked"),
      binding("client-live", "2026-01-01T00:00:00Z", "active"),
    ]);
    expect((await getPortalClientRef("user_mixed"))?.id).toBe("client-live");
  });

  it("never reads the cookie when the user holds no binding rows", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue(null);
    await getPortalClientRef("user_cookieless");
    expect(cookieMock).not.toHaveBeenCalled();
  });
});

describe("getPortalBindings", () => {
  it("publishes only the ACTIVE bindings", async () => {
    listMock.mockResolvedValue([
      binding("client-live", "2026-06-01T00:00:00Z", "active"),
      binding("client-gone", "2026-05-01T00:00:00Z", "revoked"),
      binding("client-asked", "2026-04-01T00:00:00Z", "pending"),
    ]);
    const rows = await getPortalBindings("user_switcher");
    expect(rows.map((b) => b.clientId)).toEqual(["client-live"]);
  });

  it("returns [] for an empty userId without issuing a query", async () => {
    expect(await getPortalBindings("")).toEqual([]);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("getPortalClientId", () => {
  it("returns clientId when the clerk user is bound", async () => {
    listMock.mockResolvedValue([binding("client-1", "2026-01-01T00:00:00Z")]);
    expect(await getPortalClientId("user_id_bound")).toBe("client-1");
  });

  it("returns null when the user has neither a binding nor a legacy row", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue(null);
    expect(await getPortalClientId("user_id_unbound")).toBeNull();
  });

  it("returns null for an empty userId without issuing any query", async () => {
    expect(await getPortalClientId("")).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
    expect(legacyMock).not.toHaveBeenCalled();
    expect(cookieMock).not.toHaveBeenCalled();
  });
});
