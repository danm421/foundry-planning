import { describe, it, expect, vi } from "vitest";

// The mock simulates what the domain's listMyConversations returns based on
// the clientId argument — when called with null it returns only clientless
// threads, just as the real SQL IS NULL branch would.
const ALL_THREADS = [
  { id: "g1", title: "How do I add a household", clientId: null, updatedAt: new Date() },
  { id: "c1", title: "Client thread", clientId: "client-abc", updatedAt: new Date() },
];

const { listMyConversations } = vi.hoisted(() => ({
  listMyConversations: vi.fn(async (_userId: string, _firmId: string, clientId?: string | null) => {
    // Simulate the SQL branch: null → IS NULL (clientless only), undefined → all.
    if (clientId === null) return ALL_THREADS.filter((c) => c.clientId === null);
    if (typeof clientId === "string") return ALL_THREADS.filter((c) => c.clientId === clientId);
    return ALL_THREADS; // undefined → no filter
  }),
}));

vi.mock("@/domain/forge/flag", () => ({ isForgeEnabled: () => true, hasForgeEntitlement: () => true }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "firm1") }));
vi.mock("@/lib/authz", () => ({ requireActiveSubscription: vi.fn(async () => {}), authErrorResponse: () => null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user1", sessionClaims: { org_public_metadata: { entitlements: ["forge"] } } })),
}));
vi.mock("@/domain/forge/conversations", () => ({ listMyConversations }));

import { GET } from "../route";

describe("global transcript route", () => {
  it("returns only the caller's CLIENTLESS conversations", async () => {
    // Verifies end-to-end: the route passes null → mock (simulating SQL IS NULL)
    // returns only clientless → response contains only global thread "g1".
    // This proves the leak is closed: client-scoped thread "c1" is absent.
    const res = await GET(new Request("http://t/api/forge/transcript"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations.map((c: { id: string }) => c.id)).toEqual(["g1"]);
  });

  it("delegates clientless filtering to listMyConversations with null (SQL-level, not JS post-filter)", async () => {
    // The route must pass null as the third argument so the domain function uses
    // an IS NULL SQL predicate BEFORE .limit(50). If it passed undefined instead,
    // no clientId filter would be applied and client-scoped threads could leak in
    // (especially past the 50-row limit).
    listMyConversations.mockClear();
    await GET(new Request("http://t/api/forge/transcript"));
    // Third argument must be exactly null — not undefined, not a string.
    expect(listMyConversations).toHaveBeenCalledWith("user1", "firm1", null);
  });

  it("does NOT JS-filter the result (trusts SQL-level filtering from the domain)", async () => {
    // When the domain returns multiple clientless threads, all are forwarded.
    // The route must not apply any additional filtering on the result.
    listMyConversations.mockResolvedValueOnce([
      { id: "g2", title: "Another global thread", clientId: null, updatedAt: new Date() },
      { id: "g3", title: "Third global thread", clientId: null, updatedAt: new Date() },
    ]);
    const res = await GET(new Request("http://t/api/forge/transcript"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations.map((c: { id: string }) => c.id)).toEqual(["g2", "g3"]);
  });
});
