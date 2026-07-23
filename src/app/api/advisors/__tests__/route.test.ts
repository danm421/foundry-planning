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
      { userId: "adv_a", displayName: "Alice", email: null, imageUrl: null, role: "Member" },
      { userId: "adv_b", displayName: "Bob", email: null, imageUrl: null, role: "Admin" },
      { userId: "ops_c", displayName: "Carol", email: null, imageUrl: null, role: "Operations" },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(
      body.advisors.map((a: { userId: string }) => a.userId).sort(),
    ).toEqual(["adv_a", "adv_b"]);
  });

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
