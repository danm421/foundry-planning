import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockUpdateUserMetadata = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      updateUserMetadata: (...a: unknown[]) => mockUpdateUserMetadata(...a),
    },
  }),
}));

import {
  readPendingSignup,
  writePendingSignup,
  clearPendingSignup,
} from "../pending-signup";

beforeEach(() => {
  mockGetUser.mockReset();
  mockUpdateUserMetadata.mockReset();
});

describe("pending signup stash", () => {
  it("returns null when the user has never started setup", async () => {
    mockGetUser.mockResolvedValue({ privateMetadata: {} });
    expect(await readPendingSignup("user_1")).toBeNull();
  });

  it("returns null rather than throwing when Clerk is unreachable", async () => {
    // A read failure must degrade to an empty form, never a crashed setup page.
    mockGetUser.mockRejectedValue(new Error("clerk down"));
    expect(await readPendingSignup("user_1")).toBeNull();
  });

  it("round-trips a saved profile", async () => {
    mockGetUser.mockResolvedValue({
      privateMetadata: {
        pending_signup: {
          firmName: "Acme Wealth",
          advisorName: "Dana Reed",
          plan: "annual",
          primaryColor: "#0f7d6c",
          logoUrl: "https://blob.example/logo.png",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      },
    });
    expect(await readPendingSignup("user_1")).toEqual({
      firmName: "Acme Wealth",
      advisorName: "Dana Reed",
      plan: "annual",
      primaryColor: "#0f7d6c",
      logoUrl: "https://blob.example/logo.png",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
  });

  it("merges a patch onto the existing stash instead of replacing it", async () => {
    // The branding panel saves the logo on its own, while the name fields are
    // still being typed. A replacing write would silently drop the firm name.
    mockGetUser.mockResolvedValue({
      privateMetadata: {
        pending_signup: {
          firmName: "Acme Wealth",
          advisorName: "Dana Reed",
          plan: "annual",
          primaryColor: null,
          logoUrl: null,
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      },
    });
    const next = await writePendingSignup("user_1", {
      logoUrl: "https://blob.example/logo.png",
    });
    expect(next.firmName).toBe("Acme Wealth");
    expect(next.logoUrl).toBe("https://blob.example/logo.png");
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("user_1", {
      privateMetadata: { pending_signup: next },
    });
  });

  it("preserves other private metadata when writing", async () => {
    mockGetUser.mockResolvedValue({
      privateMetadata: { some_other_key: "keep me" },
    });
    await writePendingSignup("user_1", { firmName: "Acme" });
    const [, arg] = mockUpdateUserMetadata.mock.calls[0]!;
    expect((arg as { privateMetadata: Record<string, unknown> }).privateMetadata
      .some_other_key).toBe("keep me");
  });

  it("drops a stash that is missing a firm name", async () => {
    // Defensive: hand-edited or half-written metadata must not reach the webhook.
    mockGetUser.mockResolvedValue({
      privateMetadata: { pending_signup: { advisorName: "Dana Reed" } },
    });
    expect(await readPendingSignup("user_1")).toBeNull();
  });

  it("clears the stash with a null tombstone, because Clerk deep-merges", async () => {
    // updateUserMetadata performs a DEEP MERGE — an object with the key merely
    // omitted removes nothing, and the stash would outlive the firm. Clerk
    // deletes a key only when its value is null. Asserting the tombstone (not
    // the surviving siblings) is what makes this test fail against the old
    // key-omitting implementation, which sent `{ privateMetadata: { other: 1 } }`.
    mockGetUser.mockResolvedValue({
      privateMetadata: { pending_signup: { firmName: "Acme" }, other: 1 },
    });
    await clearPendingSignup("user_1");
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("user_1", {
      privateMetadata: { pending_signup: null },
    });
  });

  it("leaves other private metadata alone without reading it back first", async () => {
    // The merge preserves siblings by construction, so the clear needs no
    // read-modify-write. Sending any other key here would risk clobbering a
    // concurrent write.
    await clearPendingSignup("user_1");
    expect(mockGetUser).not.toHaveBeenCalled();
    const [, arg] = mockUpdateUserMetadata.mock.calls[0]!;
    expect(
      Object.keys(
        (arg as { privateMetadata: Record<string, unknown> }).privateMetadata,
      ),
    ).toEqual(["pending_signup"]);
  });

  it("reads a cleared stash as absent, not as a broken record", async () => {
    // The tombstone is what Clerk stores until it prunes the key; coerce() must
    // treat it exactly like a user who never started setup.
    mockGetUser.mockResolvedValue({
      privateMetadata: { pending_signup: null },
    });
    expect(await readPendingSignup("user_1")).toBeNull();
  });
});
