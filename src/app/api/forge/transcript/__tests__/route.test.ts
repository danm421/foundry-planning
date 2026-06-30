import { describe, it, expect, vi } from "vitest";

const { listMyConversations } = vi.hoisted(() => ({
  listMyConversations: vi.fn(async () => [
    { id: "g1", title: "How do I add a household", clientId: null, updatedAt: new Date() },
    { id: "c1", title: "Client thread", clientId: "client-abc", updatedAt: new Date() },
  ]),
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
    const res = await GET(new Request("http://t/api/forge/transcript"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations.map((c: { id: string }) => c.id)).toEqual(["g1"]);
  });
});
