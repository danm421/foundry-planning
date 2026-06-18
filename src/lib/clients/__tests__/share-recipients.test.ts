import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUserList = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: mockGetUserList } }),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: vi.fn(),
}));

import { resolveRecipientByEmail, isMemberOfFirm } from "../share-recipients";
import { listFirmMembers } from "@/lib/crm-tasks/members";

beforeEach(() => vi.clearAllMocks());

describe("resolveRecipientByEmail", () => {
  it("returns the matched user", async () => {
    mockGetUserList.mockResolvedValue({
      data: [{ id: "user_x", emailAddresses: [{ emailAddress: "a@b.com" }] }],
    });
    expect(await resolveRecipientByEmail("a@b.com")).toEqual({ userId: "user_x", email: "a@b.com" });
  });
  it("returns null when no Foundry user matches", async () => {
    mockGetUserList.mockResolvedValue({ data: [] });
    expect(await resolveRecipientByEmail("nobody@x.com")).toBeNull();
  });
});

describe("isMemberOfFirm", () => {
  it("true when the user is in the firm's members", async () => {
    vi.mocked(listFirmMembers).mockResolvedValue([
      { userId: "user_x", displayName: "X", email: null, imageUrl: null },
    ]);
    expect(await isMemberOfFirm("user_x", "org_a")).toBe(true);
  });
  it("false otherwise", async () => {
    vi.mocked(listFirmMembers).mockResolvedValue([]);
    expect(await isMemberOfFirm("user_x", "org_a")).toBe(false);
  });
});
