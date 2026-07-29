import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUserList = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: mockGetUserList } }),
}));

import { resolveRecipientByEmail } from "../share-recipients";

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
