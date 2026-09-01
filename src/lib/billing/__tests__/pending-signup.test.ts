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

  // The merge test above seeds a stash that ALREADY has a firm name — the only
  // case in which the old merge worked. The setup step's real order is the
  // opposite: the branding panel fires the upload the instant a file is picked,
  // and the firm name is not saved until "Continue". So this replays
  // both writes, in that order, against one stored record. Under the old merge
  // the second write read the nameless stash through coerce(), got null, fell
  // back to EMPTY, and wrote logoUrl: null — every first-time buyer who
  // uploaded a logo was provisioned with no branding at all.
  it("keeps a logo saved BEFORE the firm name — the setup step's real order", async () => {
    const stored: Record<string, unknown> = {};
    mockGetUser.mockImplementation(async () => ({ privateMetadata: stored }));
    mockUpdateUserMetadata.mockImplementation(
      async (_userId: string, arg: { privateMetadata: Record<string, unknown> }) => {
        Object.assign(stored, arg.privateMetadata);
      },
    );

    // 1. onLogoChosen → uploadSignupLogo. Nothing has saved a name yet.
    await writePendingSignup("user_1", { logoUrl: "https://blob.example/logo.png" });
    // 2. onContinue → saveSignupProfile. Its patch carries no logoUrl.
    const next = await writePendingSignup("user_1", {
      firmName: "Acme Wealth",
      advisorName: "Dana Reed",
      primaryColor: "#0f7d6c",
      plan: "monthly",
    });

    expect(next.logoUrl).toBe("https://blob.example/logo.png");
    expect(next.firmName).toBe("Acme Wealth");
    // And what the webhook will actually read back off the stored record.
    expect(await readPendingSignup("user_1")).toMatchObject({
      firmName: "Acme Wealth",
      logoUrl: "https://blob.example/logo.png",
      primaryColor: "#0f7d6c",
      plan: "monthly",
    });
  });

  it("still hides a nameless stash from readers, logo or no logo", async () => {
    // The counterpart guard: making the MERGE tolerant of a nameless stash must
    // not make the READ tolerant of one. This is what stops a half-written
    // record reaching the webhook and provisioning a nameless firm.
    mockGetUser.mockResolvedValue({
      privateMetadata: {
        pending_signup: { firmName: "  ", logoUrl: "https://blob.example/logo.png" },
      },
    });
    expect(await readPendingSignup("user_1")).toBeNull();
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
