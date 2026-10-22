import { describe, it, expect, vi, beforeEach } from "vitest";

const getHouseholds = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({
  isProviderId: (id: string) => id === "addepar" || id === "orion",
  getProvider: (id: string) => ({
    id,
    label: id === "addepar" ? "Addepar" : "Orion",
    syncs: true,
    isEnabled: () => true,
    client: { getHouseholds },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationApiLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(
    () => new Response(JSON.stringify({ error: "rl" }), { status: 429 }),
  ),
}));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/auth", () => ({ connectionCallContext: vi.fn() }));
vi.mock("@/lib/integrations/households", async (orig) => ({
  ...(await orig<typeof import("@/lib/integrations/households")>()),
  getLinksForConnection: vi.fn(),
  listFirmLinksOutside: vi.fn(),
}));
vi.mock("@/lib/integrations/household-table", async (orig) => ({
  ...(await orig<typeof import("@/lib/integrations/household-table")>()),
  countConnectedAccounts: vi.fn(),
}));
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors: vi.fn() }));
vi.mock("@/lib/visibility", async (orig) => ({
  ...(await orig<typeof import("@/lib/visibility")>()),
  resolveVisibleAdvisorIds: vi.fn(),
}));

import { GET } from "./route";
import { auth } from "@clerk/nextjs/server";
import { checkIntegrationApiLimit } from "@/lib/rate-limit";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { connectionCallContext } from "@/lib/integrations/auth";
import { getLinksForConnection, listFirmLinksOutside } from "@/lib/integrations/households";
import { countConnectedAccounts } from "@/lib/integrations/household-table";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { encodeAddeparConfig } from "@/lib/integrations/providers/addepar/credentials";
import { VISIBLE_ALL, resolveVisibleAdvisorIds } from "@/lib/visibility";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = {
  id: CONN,
  firmId: "firm_1",
  providerId: "addepar",
  ownerUserId: "u1",
  status: "connected",
  scope: encodeAddeparConfig({ apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" }),
};

const ctx = (provider = "addepar") => ({ params: Promise.resolve({ provider, connectionId: CONN }) });
const req = () => new Request(`https://app.test/api/integrations/addepar/connections/${CONN}/households`);

function link(over: { id: string; clientId: string; externalHouseholdId: string }) {
  return { lastPullAccounts: null, linkedByUserId: "u1", ...over };
}

/** A link held through another connection, as `listFirmLinksOutside` returns it. */
function outsideLink(over: {
  clientId: string;
  externalHouseholdId: string;
  providerId?: string;
  externalFirmId?: string | null;
  linkedByUserId?: string | null;
  advisorId?: string;
  isPrivate?: boolean;
}) {
  return {
    providerId: "addepar",
    externalFirmId: "1069",
    linkedByUserId: "user_sarah",
    advisorId: "user_sarah",
    isPrivate: false,
    ...over,
  };
}

const SARAH = new Map([["user_sarah", { name: "Sarah Kim", isSystem: false }]]);

beforeEach(() => {
  vi.clearAllMocks();
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (checkIntegrationApiLimit as any).mockResolvedValue({ allowed: true });
  (connectionCallContext as any).mockResolvedValue({ connectionId: CONN });
  getHouseholds.mockResolvedValue([{ id: "g1", name: "Doe Family" }]);
  (getLinksForConnection as any).mockResolvedValue([]);
  (listFirmLinksOutside as any).mockResolvedValue([]);
  (countConnectedAccounts as any).mockResolvedValue(new Map());
  (resolveActors as any).mockResolvedValue(new Map());
  (resolveVisibleAdvisorIds as any).mockResolvedValue(VISIBLE_ALL);
});

describe("GET …/connections/[connectionId]/households", () => {
  it("404 for a colleague's connection id", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(getHouseholds).not.toHaveBeenCalled();
    expect(checkIntegrationApiLimit).not.toHaveBeenCalled();
  });

  it("404 when the connection belongs to another provider than the URL", async () => {
    (getOwnedConnection as any).mockResolvedValue({ ...connection, providerId: "orion" });
    const res = await GET(req(), ctx("addepar"));
    expect(res.status).toBe(404);
    expect(getHouseholds).not.toHaveBeenCalled();
  });

  it("404 with no session, before any lookup", async () => {
    (auth as any).mockResolvedValue({ orgId: null, userId: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(getOwnedConnection).not.toHaveBeenCalled();
  });

  it("rows come back sorted with account counts", async () => {
    getHouseholds.mockResolvedValue([
      { id: "g3", name: "Zed" },
      { id: "g1", name: "Adams" },
      { id: "g2", name: "Moss" },
      { id: "g4", name: "Quill" },
    ]);
    const links = [
      link({ id: "L2", clientId: "c2", externalHouseholdId: "g2" }),
      link({ id: "L4", clientId: "c4", externalHouseholdId: "g4" }),
    ];
    (getLinksForConnection as any).mockResolvedValue(links);
    // L4 has never been pulled, so it has no entry.
    (countConnectedAccounts as any).mockResolvedValue(new Map([["L2", { connected: 6, total: 9 }]]));

    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.households).toEqual([
      { id: "g2", name: "Moss", link: { linkId: "L2", clientId: "c2" }, lockedBy: null, accounts: { connected: 6, total: 9 } },
      { id: "g4", name: "Quill", link: { linkId: "L4", clientId: "c4" }, lockedBy: null, accounts: null },
      { id: "g1", name: "Adams", link: null, lockedBy: null, accounts: null },
      { id: "g3", name: "Zed", link: null, lockedBy: null, accounts: null },
    ]);
    expect(body.takenClients).toEqual({});
    expect(getLinksForConnection).toHaveBeenCalledWith(CONN);
    expect(countConnectedAccounts).toHaveBeenCalledWith({ providerId: "addepar", links });
    // One groups call, through this connection's own context.
    expect(getHouseholds).toHaveBeenCalledTimes(1);
    expect(connectionCallContext).toHaveBeenCalledWith(CONN);
    // The limiter buckets per connection, not per firm.
    expect((checkIntegrationApiLimit as any).mock.calls[0][0]).toBe(`addepar:${CONN}`);
  });

  it("takenClients names the linker", async () => {
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c8", externalHouseholdId: "g7" }),
      outsideLink({ clientId: "c9", externalFirmId: "2000", externalHouseholdId: "g8" }),
      outsideLink({ clientId: "c10", externalHouseholdId: "g9", linkedByUserId: null }),
      // Linked through another provider's connection: a client has one link,
      // so it's taken here too.
      outsideLink({
        clientId: "c11",
        providerId: "orion",
        externalFirmId: null,
        externalHouseholdId: "hh1",
        linkedByUserId: "user_lee",
      }),
    ]);
    (resolveActors as any).mockResolvedValue(
      new Map([
        ["user_sarah", { name: "Sarah Kim", isSystem: false }],
        ["user_lee", { name: "Lee Park", isSystem: false }],
      ]),
    );

    const body = await (await GET(req(), ctx())).json();

    expect(body.takenClients).toEqual({
      c8: "Sarah Kim",
      c9: "Sarah Kim",
      c10: "another advisor",
      c11: "Lee Park",
    });
    expect(listFirmLinksOutside).toHaveBeenCalledWith({ firmId: "firm_1", connectionId: CONN });
    // One Clerk lookup, each linker once.
    expect(resolveActors).toHaveBeenCalledWith(["user_sarah", "user_lee"]);
  });

  it("lockedBy names the linker only for a household held under the same Addepar firm", async () => {
    getHouseholds.mockResolvedValue([
      { id: "g7", name: "Held here" },
      { id: "g8", name: "Same id, other firm" },
    ]);
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c8", externalHouseholdId: "g7" }),
      outsideLink({ clientId: "c9", externalFirmId: "2000", externalHouseholdId: "g8" }),
    ]);
    (resolveActors as any).mockResolvedValue(SARAH);

    const body = await (await GET(req(), ctx())).json();
    const byId = Object.fromEntries(body.households.map((h: any) => [h.id, h.lockedBy]));

    expect(byId).toEqual({ g7: "Sarah Kim", g8: null });
  });

  it("lockedBy ignores the same household id held through another provider", async () => {
    // An Orion connection: no Addepar firm, so only the provider tells a
    // Schwab household id apart from an Orion one.
    (getOwnedConnection as any).mockResolvedValue({ ...connection, providerId: "orion", scope: null });
    getHouseholds.mockResolvedValue([
      { id: "hh1", name: "Held on Orion" },
      { id: "hh2", name: "Same id on Schwab" },
    ]);
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c8", providerId: "orion", externalFirmId: null, externalHouseholdId: "hh1" }),
      outsideLink({ clientId: "c9", providerId: "schwab", externalFirmId: null, externalHouseholdId: "hh2" }),
    ]);
    (resolveActors as any).mockResolvedValue(SARAH);

    const body = await (await GET(req(), ctx("orion"))).json();
    const byId = Object.fromEntries(body.households.map((h: any) => [h.id, h.lockedBy]));

    expect(byId).toEqual({ hh1: "Sarah Kim", hh2: null });
    // Both clients are still taken: one link per client, whatever the provider.
    expect(body.takenClients).toEqual({ c8: "Sarah Kim", c9: "Sarah Kim" });
  });

  it("takenClients leaves out another advisor's client in a siloed firm, but its household stays locked", async () => {
    // A siloed advisor sees only their own book.
    (resolveVisibleAdvisorIds as any).mockResolvedValue(new Set(["u1"]));
    getHouseholds.mockResolvedValue([{ id: "g7", name: "Sarah's household" }]);
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c-mine", externalHouseholdId: "g6", advisorId: "u1" }),
      outsideLink({ clientId: "c-hers", externalHouseholdId: "g7", advisorId: "user_sarah" }),
    ]);
    (resolveActors as any).mockResolvedValue(SARAH);

    const body = await (await GET(req(), ctx())).json();

    expect(resolveVisibleAdvisorIds).toHaveBeenCalledWith("u1", "org:member", "firm_1");
    expect(body.takenClients).toEqual({ "c-mine": "Sarah Kim" });
    // The household carries no client id and sits in the caller's own book,
    // so it still names who holds it.
    expect(body.households[0].lockedBy).toBe("Sarah Kim");
  });

  it("takenClients leaves out another advisor's Private client, but not the caller's own", async () => {
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c-private-hers", externalHouseholdId: "g6", advisorId: "user_sarah", isPrivate: true }),
      outsideLink({ clientId: "c-private-mine", externalHouseholdId: "g7", advisorId: "u1", isPrivate: true }),
      outsideLink({ clientId: "c-open", externalHouseholdId: "g8" }),
    ]);
    (resolveActors as any).mockResolvedValue(SARAH);

    const body = await (await GET(req(), ctx())).json();

    expect(body.takenClients).toEqual({ "c-private-mine": "Sarah Kim", "c-open": "Sarah Kim" });
  });

  it("an admin is told about every taken client, Private ones included", async () => {
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    (listFirmLinksOutside as any).mockResolvedValue([
      outsideLink({ clientId: "c-private-hers", externalHouseholdId: "g6", isPrivate: true }),
    ]);
    (resolveActors as any).mockResolvedValue(SARAH);

    const body = await (await GET(req(), ctx())).json();

    expect(body.takenClients).toEqual({ "c-private-hers": "Sarah Kim" });
  });

  it("does not reach the provider when rate limited", async () => {
    (checkIntegrationApiLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(429);
    expect(getHouseholds).not.toHaveBeenCalled();
  });
});
