import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  authMock,
  clerkClientMock,
  getOrgMock,
  listMock,
  revokeMock,
  notifyMock,
  householdNamesMock,
  displayNamesMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  clerkClientMock: vi.fn(),
  getOrgMock: vi.fn(),
  listMock: vi.fn(),
  revokeMock: vi.fn(),
  notifyMock: vi.fn(),
  householdNamesMock: vi.fn(),
  displayNamesMock: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock, clerkClient: clerkClientMock }));
vi.mock("@/lib/portal/bindings", () => ({
  listActiveBindings: listMock,
  revokeBinding: revokeMock,
}));
vi.mock("@/lib/notifications/producers/portal", () => ({ notifyPortalDisconnected: notifyMock }));
// Both name lookups are mocked at their DB boundary so this suite never reaches
// a live database.
vi.mock("@/lib/portal/household-names", () => ({ resolveHouseholdNames: householdNamesMock }));
vi.mock("@/lib/branding/db", () => ({ getFirmDisplayNames: displayNamesMock }));
// `resolveFirmNames` is deliberately NOT mocked: its dedupe and its per-org
// try/catch are the behaviour under test here, and the only way to see "one
// Clerk lookup per firm" — or a real outage — is to let it run against the
// Clerk mock below.

import { GET, DELETE } from "@/app/api/portal/connections/route";

const del = (body: unknown) =>
  new Request("http://x/api/portal/connections", { method: "DELETE", body: JSON.stringify(body) });

const ACCEPTED = new Date("2026-03-04T09:00:00Z");

function binding(over: Partial<{
  bindingId: string;
  clientId: string;
  firmId: string;
  advisorId: string;
  acceptedAt: Date | null;
}> = {}) {
  return {
    bindingId: "b1",
    clientId: "client-1",
    firmId: "org_a",
    advisorId: "user_adv",
    acceptedAt: ACCEPTED,
    ...over,
  };
}

beforeEach(() => {
  authMock.mockReset();
  clerkClientMock.mockReset();
  getOrgMock.mockReset();
  listMock.mockReset();
  revokeMock.mockReset();
  notifyMock.mockReset();
  householdNamesMock.mockReset();
  displayNamesMock.mockReset();

  authMock.mockResolvedValue({ userId: "user_1", orgId: null });
  listMock.mockResolvedValue([binding()]);
  revokeMock.mockResolvedValue(true);
  notifyMock.mockResolvedValue(undefined);
  householdNamesMock.mockResolvedValue(new Map());
  displayNamesMock.mockResolvedValue(new Map());
  getOrgMock.mockResolvedValue({ name: "Northgate Advisors" });
  clerkClientMock.mockResolvedValue({ organizations: { getOrganization: getOrgMock } });
});

afterEach(() => {
  // Restores any console spy a test installed, even if an assertion threw.
  vi.restoreAllMocks();
});

describe("GET /api/portal/connections", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    expect((await GET()).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("403s an advisor session", async () => {
    // An advisor has an active org. This is the client's own list of the firms
    // holding their login — never an advisor's to read.
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
    expect((await GET()).status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("scopes the read to the CALLER's user id", async () => {
    await GET();
    expect(listMock).toHaveBeenCalledWith("user_1");
  });

  it("returns an empty list without asking anyone to name anything", async () => {
    listMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connections: [] });
    expect(getOrgMock).not.toHaveBeenCalled();
    expect(householdNamesMock).not.toHaveBeenCalled();
  });

  it("assembles the full payload for a live connection", async () => {
    householdNamesMock.mockResolvedValue(new Map([["client-1", "John & Jane Cooper"]]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connections: [
        {
          clientId: "client-1",
          firmName: "Northgate Advisors",
          householdName: "John & Jane Cooper",
          since: ACCEPTED.toISOString(),
        },
      ],
    });
    expect(householdNamesMock).toHaveBeenCalledWith(["client-1"]);
  });

  it("carries a null acceptance date through rather than inventing one", async () => {
    // An invitation-path row can be `active` with no recorded acceptedAt.
    listMock.mockResolvedValue([binding({ acceptedAt: null })]);
    const { connections } = await (await GET()).json();
    expect(connections[0].since).toBeNull();
  });

  // --- Who the client is connected TO. Every row here has a Disconnect button
  // next to it, so naming the wrong party would let someone disconnect from a
  // misidentified firm. The chain is pinned end to end: live Clerk name ->
  // firms.display_name -> a neutral "A firm", and NEVER our own name.

  it("names the CACHED firm when Clerk cannot answer for it", async () => {
    getOrgMock.mockRejectedValue(new Error("clerk org lookup failed"));
    displayNamesMock.mockResolvedValue(new Map([["org_a", "Northgate Advisors"]]));
    const { connections } = await (await GET()).json();
    expect(connections[0].firmName).toBe("Northgate Advisors");
  });

  it("falls back to a NEUTRAL label, never 'Foundry Planning', when nothing names the firm", async () => {
    // Clerk down AND no cached display_name. The vendor's own name here would
    // tell the client they are connected to Foundry — with a Disconnect button
    // beside it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOrgMock.mockRejectedValue(new Error("clerk org lookup failed"));
    displayNamesMock.mockResolvedValue(new Map());
    const { connections } = await (await GET()).json();
    expect(connections[0].firmName).toBe("A firm");
    expect(connections[0].firmName).not.toMatch(/foundry/i);
  });

  it("prefers the live Clerk name over a stale cached display_name", async () => {
    // display_name is only written by the Firm settings form; a rename done in
    // Clerk's own widget never reaches it.
    displayNamesMock.mockResolvedValue(new Map([["org_a", "Old Name LLC"]]));
    const { connections } = await (await GET()).json();
    expect(connections[0].firmName).toBe("Northgate Advisors");
  });

  it("reads the display_name cache for the firms it is asked about", async () => {
    await GET();
    expect(displayNamesMock).toHaveBeenCalledWith(["org_a"]);
  });

  it("resolves one firm name per FIRM, not per connection", async () => {
    // One firm, two households (a client and their parents) is ordinary.
    // Resolving per row would be N Clerk round-trips for one answer.
    listMock.mockResolvedValue([
      binding({ bindingId: "b1", clientId: "client-1" }),
      binding({ bindingId: "b2", clientId: "client-2" }),
    ]);
    const { connections } = await (await GET()).json();
    expect(connections).toHaveLength(2);
    expect(getOrgMock).toHaveBeenCalledTimes(1);
    expect(connections.map((c: { firmName: string }) => c.firmName)).toEqual([
      "Northgate Advisors",
      "Northgate Advisors",
    ]);
  });

  it("names the firms it CAN when one firm's Clerk lookup fails", async () => {
    // Per-firm granularity: one unreachable org must not blank the other, and
    // the unreachable one falls back to its own cached name.
    listMock.mockResolvedValue([
      binding({ bindingId: "b1", clientId: "client-1", firmId: "org_a" }),
      binding({ bindingId: "b2", clientId: "client-2", firmId: "org_b" }),
    ]);
    getOrgMock.mockImplementation(async ({ organizationId }: { organizationId: string }) => {
      if (organizationId === "org_b") throw new Error("no such org");
      return { name: "Northgate Advisors" };
    });
    displayNamesMock.mockResolvedValue(new Map([["org_b", "Halyard Wealth"]]));
    const { connections } = await (await GET()).json();
    expect(connections.map((c: { firmName: string }) => c.firmName)).toEqual([
      "Northgate Advisors",
      "Halyard Wealth",
    ]);
  });

  it("labels a household no name resolves for rather than rendering a blank", async () => {
    // resolveHouseholdNames omits a household with no `primary` contact.
    householdNamesMock.mockResolvedValue(new Map());
    const { connections } = await (await GET()).json();
    expect(connections[0].householdName).toBe("Your household");
    expect(connections[0].householdName).not.toBe("");
  });
});

describe("DELETE /api/portal/connections", () => {
  it("401s with no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    expect((await DELETE(del({ clientId: "client-1" }))).status).toBe(401);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("403s an advisor session", async () => {
    authMock.mockResolvedValue({ userId: "user_1", orgId: "org_1" });
    expect((await DELETE(del({ clientId: "client-1" }))).status).toBe(403);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("revokes the caller's own binding", async () => {
    const res = await DELETE(del({ clientId: "client-1" }));
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", clerkUserId: "user_1", endedBy: "client" }),
    );
  });

  it("records the client as the one who ended it, never the advisor", async () => {
    await DELETE(del({ clientId: "client-1" }));
    expect(revokeMock.mock.calls[0][0].endedBy).toBe("client");
  });

  it("passes the CALLER's user id, never one from the body", async () => {
    await DELETE(del({ clientId: "client-1", clerkUserId: "user_victim" }));
    expect(revokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_1", actorId: "user_1" }),
    );
  });

  it("404s a household the caller does not hold", async () => {
    listMock.mockResolvedValue([]);
    const res = await DELETE(del({ clientId: "client-someone-else" }));
    expect(res.status).toBe(404);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("404s when the revoke itself finds nothing to end", async () => {
    // A concurrent advisor-side revoke won the race; the answer must be honest.
    revokeMock.mockResolvedValue(false);
    expect((await DELETE(del({ clientId: "client-1" }))).status).toBe(404);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("400s a missing clientId", async () => {
    expect((await DELETE(del({}))).status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("400s a non-string clientId rather than passing it to the query", async () => {
    expect((await DELETE(del({ clientId: { $ne: null } }))).status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("400s an unparseable body", async () => {
    const req = new Request("http://x/api/portal/connections", { method: "DELETE", body: "{" });
    expect((await DELETE(req)).status).toBe(400);
  });

  it("notifies the owning advisor AFTER the revoke commits", async () => {
    const order: string[] = [];
    revokeMock.mockImplementation(async () => {
      order.push("revoke");
      return true;
    });
    notifyMock.mockImplementation(async () => {
      order.push("notify");
    });
    await DELETE(del({ clientId: "client-1" }));
    expect(order).toEqual(["revoke", "notify"]);
  });

  it("names the household in the advisor's notification", async () => {
    householdNamesMock.mockResolvedValue(new Map([["client-1", "John & Jane Cooper"]]));
    await DELETE(del({ clientId: "client-1" }));
    expect(notifyMock).toHaveBeenCalledWith({
      firmId: "org_a",
      advisorId: "user_adv",
      clientId: "client-1",
      clientName: "John & Jane Cooper",
    });
  });

  it("sends a null name rather than a blank one when the household has none", async () => {
    householdNamesMock.mockResolvedValue(new Map());
    await DELETE(del({ clientId: "client-1" }));
    expect(notifyMock.mock.calls[0][0].clientName).toBeNull();
  });

  it("still succeeds when the notification fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    notifyMock.mockRejectedValue(new Error("notify down"));
    expect((await DELETE(del({ clientId: "client-1" }))).status).toBe(200);
  });

  it("still succeeds when the household-name lookup fails", async () => {
    // The name is only decoration on the advisor's notification. Throwing here
    // would 500 a disconnect that has ALREADY committed, telling the client
    // their request failed when their access is in fact gone.
    vi.spyOn(console, "error").mockImplementation(() => {});
    householdNamesMock.mockRejectedValue(new Error("db down"));
    const res = await DELETE(del({ clientId: "client-1" }));
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalled();
  });
});
