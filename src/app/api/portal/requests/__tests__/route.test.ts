import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authMock,
  listMock,
  acceptMock,
  declineMock,
  getUserMock,
  clerkClientMock,
  householdNamesMock,
  firmNameMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  listMock: vi.fn(),
  acceptMock: vi.fn(),
  declineMock: vi.fn(),
  getUserMock: vi.fn(),
  clerkClientMock: vi.fn(),
  householdNamesMock: vi.fn(),
  firmNameMock: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock, clerkClient: clerkClientMock }));
vi.mock("@/lib/portal/bindings", () => ({
  listPendingRequests: listMock,
  acceptBinding: acceptMock,
  declineBinding: declineMock,
}));
// Mocked so this suite never reaches a live database through the name join.
vi.mock("@/lib/portal/household-names", () => ({ resolveHouseholdNames: householdNamesMock }));
vi.mock("@/lib/branding/branding", () => ({ resolveFirmName: firmNameMock }));

import { GET, POST } from "@/app/api/portal/requests/route";

const post = (body: unknown) =>
  new Request("http://x/api/portal/requests", { method: "POST", body: JSON.stringify(body) });

const EXPIRES = new Date("2026-09-23T00:00:00Z");

function pending(over: Partial<{
  bindingId: string;
  clientId: string;
  firmId: string;
  requestedBy: string | null;
  expiresAt: Date | null;
}> = {}) {
  return {
    bindingId: "b1",
    clientId: "client-1",
    firmId: "org_a",
    requestedBy: "user_advisor",
    expiresAt: EXPIRES,
    ...over,
  };
}

beforeEach(() => {
  authMock.mockReset();
  listMock.mockReset();
  acceptMock.mockReset();
  declineMock.mockReset();
  getUserMock.mockReset();
  householdNamesMock.mockReset();
  firmNameMock.mockReset();

  authMock.mockResolvedValue({ userId: "user_1", orgId: null });
  listMock.mockResolvedValue([]);
  householdNamesMock.mockResolvedValue(new Map());
  firmNameMock.mockResolvedValue("Northgate Advisors");
  getUserMock.mockResolvedValue({ firstName: "Dana", lastName: "Reed" });
  clerkClientMock.mockResolvedValue({ users: { getUser: getUserMock } });
});

describe("GET /api/portal/requests", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    expect((await GET()).status).toBe(401);
  });

  it("403s an advisor session", async () => {
    // An advisor has an active org. Portal surfaces are closed to them.
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
    expect((await GET()).status).toBe(403);
  });

  it("serves a person who holds NO binding yet", async () => {
    // The whole point: a first-time requester has nothing to gate on but
    // their own session.
    listMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [] });
  });

  it("scopes the read to the CALLER's user id", async () => {
    await GET();
    expect(listMock).toHaveBeenCalledWith("user_1");
  });

  // --- The assembled payload. Every test above short-circuits at
  // `pending.length === 0`, so without these the name/firm/advisor resolution
  // — the whole reason this endpoint exists — ships untested.

  it("assembles the full payload for a pending request", async () => {
    listMock.mockResolvedValue([pending()]);
    householdNamesMock.mockResolvedValue(new Map([["client-1", "John & Jane Cooper"]]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      requests: [
        {
          bindingId: "b1",
          householdName: "John & Jane Cooper",
          firmName: "Northgate Advisors",
          advisorName: "Dana Reed",
          expiresAt: EXPIRES.toISOString(),
        },
      ],
    });
    expect(householdNamesMock).toHaveBeenCalledWith(["client-1"]);
  });

  it("passes null as the cached firm name — Clerk is the source of truth here", async () => {
    // The portal holds no `firms.display_name` cache of its own, and
    // resolveFirmName's second argument is required.
    listMock.mockResolvedValue([pending()]);
    await GET();
    expect(firmNameMock).toHaveBeenCalledWith("org_a", null);
  });

  it("falls back to a neutral household label when no name resolves", async () => {
    listMock.mockResolvedValue([pending()]);
    householdNamesMock.mockResolvedValue(new Map());
    const { requests } = await (await GET()).json();
    expect(requests[0].householdName).toBe("your household");
  });

  it("degrades advisorName to null when Clerk cannot resolve the requester", async () => {
    // A Clerk hiccup must not 500 the whole list — the client can still see
    // which firm is asking and decide.
    listMock.mockResolvedValue([pending()]);
    getUserMock.mockRejectedValue(new Error("clerk down"));
    const res = await GET();
    expect(res.status).toBe(200);
    const { requests } = await res.json();
    expect(requests[0].advisorName).toBeNull();
    expect(requests[0].firmName).toBe("Northgate Advisors");
  });

  it("degrades advisorName to null when the Clerk client itself is unavailable", async () => {
    listMock.mockResolvedValue([pending()]);
    clerkClientMock.mockRejectedValue(new Error("clerk unreachable"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).requests[0].advisorName).toBeNull();
  });

  it("reports no advisor name for a request with no recorded requester", async () => {
    listMock.mockResolvedValue([pending({ requestedBy: null })]);
    const { requests } = await (await GET()).json();
    expect(requests[0].advisorName).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("resolves one firm name per FIRM, not per request", async () => {
    // Two households at the same firm is the ordinary case (a client and their
    // parents). Resolving per row would be N Clerk round-trips for one answer.
    listMock.mockResolvedValue([
      pending({ bindingId: "b1", clientId: "client-1" }),
      pending({ bindingId: "b2", clientId: "client-2" }),
    ]);
    const { requests } = await (await GET()).json();
    expect(requests).toHaveLength(2);
    expect(firmNameMock).toHaveBeenCalledTimes(1);
    expect(requests[0].firmName).toBe("Northgate Advisors");
    expect(requests[1].firmName).toBe("Northgate Advisors");
  });

  it("resolves one advisor name per REQUESTER, not per request", async () => {
    listMock.mockResolvedValue([
      pending({ bindingId: "b1", clientId: "client-1" }),
      pending({ bindingId: "b2", clientId: "client-2" }),
    ]);
    await GET();
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("still names each firm when two different firms are asking", async () => {
    listMock.mockResolvedValue([
      pending({ bindingId: "b1", firmId: "org_a" }),
      pending({ bindingId: "b2", firmId: "org_b" }),
    ]);
    firmNameMock.mockImplementation(async (firmId: string) =>
      firmId === "org_a" ? "Northgate Advisors" : "Halyard Wealth",
    );
    const { requests } = await (await GET()).json();
    expect(requests.map((r: { firmName: string }) => r.firmName)).toEqual([
      "Northgate Advisors",
      "Halyard Wealth",
    ]);
  });

  it("carries a null expiry through rather than inventing a deadline", async () => {
    // A null expiresAt means "never expires" (see isExpired) — not "expired".
    listMock.mockResolvedValue([pending({ expiresAt: null })]);
    const { requests } = await (await GET()).json();
    expect(requests[0].expiresAt).toBeNull();
  });
});

describe("POST /api/portal/requests", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    expect((await POST(post({ bindingId: "b1", action: "accept" }))).status).toBe(401);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("403s an advisor session", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
    expect((await POST(post({ bindingId: "b1", action: "accept" }))).status).toBe(403);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("accepts a pending request", async () => {
    acceptMock.mockResolvedValue({ ok: true, clientId: "client-1" });
    const res = await POST(post({ bindingId: "b1", action: "accept" }));
    expect(res.status).toBe(200);
    expect(acceptMock).toHaveBeenCalledWith("b1", "user_1");
  });

  it("passes the CALLER's user id, never one from the body", async () => {
    acceptMock.mockResolvedValue({ ok: true, clientId: "client-1" });
    await POST(post({ bindingId: "b1", action: "accept", clerkUserId: "user_victim" }));
    expect(acceptMock).toHaveBeenCalledWith("b1", "user_1");
  });

  it("409s an expired request", async () => {
    acceptMock.mockResolvedValue({ ok: false, reason: "expired" });
    const res = await POST(post({ bindingId: "b1", action: "accept" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/expired/i);
  });

  it("409s a request someone already settled", async () => {
    acceptMock.mockResolvedValue({ ok: false, reason: "not_pending" });
    const res = await POST(post({ bindingId: "b1", action: "accept" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).not.toMatch(/expired/i);
  });

  it("404s a binding belonging to someone else", async () => {
    acceptMock.mockResolvedValue({ ok: false, reason: "not_found" });
    expect((await POST(post({ bindingId: "b1", action: "accept" }))).status).toBe(404);
  });

  it("declines", async () => {
    declineMock.mockResolvedValue(true);
    const res = await POST(post({ bindingId: "b1", action: "decline" }));
    expect(res.status).toBe(200);
    expect(declineMock).toHaveBeenCalledWith("b1", "user_1");
  });

  it("404s a decline of a binding belonging to someone else", async () => {
    declineMock.mockResolvedValue(false);
    expect((await POST(post({ bindingId: "b1", action: "decline" }))).status).toBe(404);
  });

  it("400s an unknown action", async () => {
    expect((await POST(post({ bindingId: "b1", action: "revoke" }))).status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
  });

  it("400s a missing bindingId", async () => {
    expect((await POST(post({ action: "accept" }))).status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("400s a non-string bindingId rather than passing it to the query", async () => {
    expect((await POST(post({ bindingId: { $ne: null }, action: "accept" }))).status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("400s an unparseable body", async () => {
    const req = new Request("http://x/api/portal/requests", { method: "POST", body: "{" });
    expect((await POST(req)).status).toBe(400);
  });
});
