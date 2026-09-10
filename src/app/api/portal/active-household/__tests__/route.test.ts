import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, listMock, setMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  listMock: vi.fn(),
  setMock: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@/lib/portal/bindings", () => ({ listActiveBindings: listMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: setMock }) }));

// `@/lib/portal/active-household` is deliberately NOT mocked: the cookie NAME
// is the contract this route shares with every reader of it, and asserting the
// literal below against a mocked constant would prove nothing. That module's
// only import is a `type`, so it pulls in no database or Clerk code.
import { POST } from "@/app/api/portal/active-household/route";

const post = (body: unknown) =>
  new Request("http://x/api/portal/active-household", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: "user_1", orgId: null });
  setMock.mockClear();
  listMock.mockReset();
  listMock.mockResolvedValue([
    { bindingId: "b1", clientId: "client-1", firmId: "org_1", advisorId: "u", acceptedAt: new Date() },
  ]);
});

describe("POST /api/portal/active-household", () => {
  it("sets the cookie for a household the caller holds", async () => {
    expect((await POST(post({ clientId: "client-1" }))).status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(
      "foundry_portal_household",
      "client-1",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("REFUSES a household the caller does not hold and sets nothing", async () => {
    const res = await POST(post({ clientId: "client-theirs" }));
    expect(res.status).toBe(404);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("403s an advisor session", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
    expect((await POST(post({ clientId: "client-1" }))).status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("401s with no session, without reading any binding", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    expect((await POST(post({ clientId: "client-1" }))).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("400s a body with no clientId", async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  // A non-string clientId must not reach the `.some()` scan as a truthy value
  // that could match nothing yet still be written to the cookie.
  it("400s a non-string clientId", async () => {
    expect((await POST(post({ clientId: { toString: () => "client-1" } }))).status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });
});
