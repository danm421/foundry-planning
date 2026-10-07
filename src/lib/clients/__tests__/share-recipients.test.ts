import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUserList = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: mockGetUserList } }),
}));

import { resolveRecipientByEmail } from "../share-recipients";

beforeEach(() => vi.clearAllMocks());

const address = (emailAddress: string, status: "verified" | "unverified") => ({
  emailAddress,
  verification: { status },
});

describe("resolveRecipientByEmail", () => {
  it("returns the user who holds the email as a verified address", async () => {
    mockGetUserList.mockResolvedValue({
      data: [{ id: "user_x", emailAddresses: [address("A@b.com", "verified")] }],
    });
    expect(await resolveRecipientByEmail(" a@B.com ")).toEqual({ userId: "user_x", email: "a@b.com" });
  });

  it("returns null when no Foundry user matches", async () => {
    mockGetUserList.mockResolvedValue({ data: [] });
    expect(await resolveRecipientByEmail("nobody@x.com")).toBeNull();
  });

  it("returns null when the only account listing the email never verified it", async () => {
    mockGetUserList.mockResolvedValue({
      data: [
        {
          id: "user_m",
          emailAddresses: [address("m@example.test", "verified"), address("x@example.test", "unverified")],
        },
      ],
    });
    expect(await resolveRecipientByEmail("x@example.test")).toBeNull();
  });

  it("picks the verified holder when an unverified copy is listed first", async () => {
    mockGetUserList.mockResolvedValue({
      data: [
        { id: "user_m", emailAddresses: [address("x@example.test", "unverified")] },
        { id: "user_x", emailAddresses: [address("x@example.test", "verified")] },
      ],
    });
    expect(await resolveRecipientByEmail("x@example.test")).toEqual({
      userId: "user_x",
      email: "x@example.test",
    });
  });

  it("returns null when more than one account claims the email as verified", async () => {
    mockGetUserList.mockResolvedValue({
      data: [
        { id: "user_a", emailAddresses: [address("x@example.test", "verified")] },
        { id: "user_b", emailAddresses: [address("x@example.test", "verified")] },
      ],
    });
    expect(await resolveRecipientByEmail("x@example.test")).toBeNull();
  });
});
