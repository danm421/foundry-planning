import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...actual, auth: vi.fn() };
});

vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { GET } from "../route";

const mockListFirmMembers = vi.mocked(listFirmMembers);

function mockAuth(opts: { userId: string; orgId: string; orgRole?: string }) {
  vi.mocked(auth).mockResolvedValue(opts as never);
}

describe("GET /api/advisors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns advisors for an admin", async () => {
    mockAuth({ userId: "u_admin", orgId: "org_a", orgRole: "org:admin" });
    mockListFirmMembers.mockResolvedValue([
      {
        userId: "adv_a",
        displayName: "Alice",
        email: null,
        imageUrl: null,
        role: "Member",
        roleKey: "org:member",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).advisors).toEqual([
      { userId: "adv_a", displayName: "Alice" },
    ]);
    expect(mockListFirmMembers).toHaveBeenCalledWith("org_a");
  });

  it("filters out non advisor-eligible roles", async () => {
    mockAuth({ userId: "u_admin", orgId: "org_a", orgRole: "org:admin" });
    mockListFirmMembers.mockResolvedValue([
      { userId: "adv_a", displayName: "Alice", email: null, imageUrl: null, role: "Member", roleKey: "org:member" },
      { userId: "adv_b", displayName: "Bob", email: null, imageUrl: null, role: "Admin", roleKey: "org:admin" },
      { userId: "ops_c", displayName: "Carol", email: null, imageUrl: null, role: "Operations", roleKey: "org:operations" },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(
      body.advisors.map((a: { userId: string }) => a.userId).sort(),
    ).toEqual(["adv_a", "adv_b"]);
  });

  // The live regression: Dan invited an advisor under a CUSTOM Clerk role
  // ("Advisor" → key org:advisor), and the eligible-role allowlist
  // ["Admin", "Member"] dropped them from the book-switcher entirely — the
  // admin had no way to view their book. Book ownership is the DEFAULT for a
  // firm member; only the book-scoped staff roles are excluded.
  it.each(["org:advisor", "basic_member", "org:senior_advisor", "org:associate"])(
    "includes a member holding the role key %s",
    async (roleKey) => {
      mockAuth({ userId: "u_admin", orgId: "org_a", orgRole: "org:admin" });
      mockListFirmMembers.mockResolvedValue([
        { userId: "adv_a", displayName: "Alice", email: null, imageUrl: null, role: "X", roleKey },
      ]);
      const res = await GET();
      const body = await res.json();
      expect(body.advisors.map((a: { userId: string }) => a.userId)).toEqual(["adv_a"]);
    },
  );

  it.each(["org:operations", "org:planner"])(
    "still excludes the book-scoped staff role %s",
    async (roleKey) => {
      mockAuth({ userId: "u_admin", orgId: "org_a", orgRole: "org:admin" });
      mockListFirmMembers.mockResolvedValue([
        { userId: "adv_a", displayName: "Alice", email: null, imageUrl: null, role: "X", roleKey: "org:advisor" },
        { userId: "staff_c", displayName: "Carol", email: null, imageUrl: null, role: "X", roleKey },
      ]);
      const res = await GET();
      const body = await res.json();
      expect(body.advisors.map((a: { userId: string }) => a.userId)).toEqual(["adv_a"]);
    },
  );

  it("403 for a non-admin", async () => {
    mockAuth({ userId: "u_adv", orgId: "org_a", orgRole: "org:member" });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockListFirmMembers).not.toHaveBeenCalled();
  });

  it("401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, orgId: "org_a" } as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockListFirmMembers).not.toHaveBeenCalled();
  });
});
