import { describe, it, expect, vi, beforeEach } from "vitest";

const { listMock, cookieMock, legacyMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  cookieMock: vi.fn(),
  legacyMock: vi.fn(),
}));

vi.mock("@/lib/portal/bindings", () => ({ listActiveBindings: listMock }));
vi.mock("next/headers", () => ({ cookies: cookieMock }));
vi.mock("@/lib/portal/legacy-binding", () => ({ legacyPortalClientRef: legacyMock }));

import { getPortalClientRef, getPortalClientId } from "@/lib/portal/get-portal-client";

function binding(clientId: string, acceptedAt: string) {
  return {
    bindingId: `b-${clientId}`,
    clientId,
    firmId: "org_1",
    advisorId: "user_a",
    acceptedAt: new Date(acceptedAt),
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
  it("returns null for a user with no bindings and no legacy row", async () => {
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

  it("falls back to the legacy column ONLY when there are no bindings", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });
    expect((await getPortalClientRef("user_legacy"))?.id).toBe("client-legacy");
  });

  it("does not consult the legacy column when a binding exists", async () => {
    listMock.mockResolvedValue([binding("client-1", "2026-01-01T00:00:00Z")]);
    legacyMock.mockResolvedValue({ id: "client-legacy", firmId: "org_1", advisorId: "user_a" });
    expect((await getPortalClientRef("user_bound"))?.id).toBe("client-1");
    expect(legacyMock).not.toHaveBeenCalled();
  });

  it("never reads the cookie when the user holds no bindings", async () => {
    listMock.mockResolvedValue([]);
    legacyMock.mockResolvedValue(null);
    await getPortalClientRef("user_cookieless");
    expect(cookieMock).not.toHaveBeenCalled();
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
