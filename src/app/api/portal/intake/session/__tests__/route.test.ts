import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const hasFormMock = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
vi.mock("@/lib/intake/queries", () => ({
  hasUnsubmittedPrefilledForm: () => hasFormMock(),
}));
const createTokenMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: () => Promise.resolve({ signInTokens: { createSignInToken: createTokenMock } }),
}));

import { POST } from "@/app/api/portal/intake/session/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
  hasFormMock.mockReset();
  hasFormMock.mockResolvedValue(true);
  createTokenMock.mockReset();
  createTokenMock.mockResolvedValue({ token: "sit_abc123" });
});

describe("POST /api/portal/intake/session", () => {
  it("mints a sign-in token for the caller's own userId", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticket: "sit_abc123" });
    expect(createTokenMock).toHaveBeenCalledWith({ userId: "u1", expiresInSeconds: 300 });
  });

  it("rejects advisor act-as mode with 403 and mints nothing", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it("returns 409 when there is no unsubmitted prefilled form", async () => {
    hasFormMock.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(409);
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 401, body: { error: "unauthorized" } });
    const res = await POST();
    expect(res.status).toBe(401);
  });
});
