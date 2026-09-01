import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));

const mockRead = vi.fn();
const mockWrite = vi.fn();
vi.mock("@/lib/billing/pending-signup", () => ({
  readPendingSignup: (...a: unknown[]) => mockRead(...a),
  writePendingSignup: (...a: unknown[]) => mockWrite(...a),
}));

const mockPutSignupAsset = vi.fn();
vi.mock("@/lib/branding/blob", () => ({
  putSignupBrandingAsset: (...a: unknown[]) => mockPutSignupAsset(...a),
}));

const mockCreateSession = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ checkout: { sessions: { create: (...a: unknown[]) => mockCreateSession(...a) } } }),
}));

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkCheckoutSessionRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

vi.mock("@/lib/billing/price-catalog", () => ({
  getPriceCatalog: () => ({ seatAnnual: "price_annual", seatMonthly: "price_monthly" }),
}));

import { saveSignupProfile, uploadSignupLogo, startSignupCheckout } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_buyer", orgId: null });
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockWrite.mockResolvedValue({});
});

describe("saveSignupProfile", () => {
  it("refuses an empty firm name — nothing downstream can provision without it", async () => {
    const res = await saveSignupProfile({ firmName: "  ", advisorName: "Dana", primaryColor: null, plan: "annual" });
    expect(res).toEqual({ ok: false, error: "Enter your firm name." });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("trims and stashes the profile", async () => {
    await saveSignupProfile({
      firmName: "  Acme Wealth ",
      advisorName: " Dana Reed ",
      primaryColor: "#0F7D6C",
      plan: "annual",
    });
    expect(mockWrite).toHaveBeenCalledWith("user_buyer", {
      firmName: "Acme Wealth",
      advisorName: "Dana Reed",
      primaryColor: "#0f7d6c",
      plan: "annual",
    });
  });

  // R11: the brief's saveSignupProfile never wrote `plan` at all, so a buyer
  // who picked monthly on the storefront got checked out at the annual price
  // — startSignupCheckout prices off PLAN_PRICE_KEY[profile.plan], read back
  // from this same stash, and coerce() in pending-signup.ts defaults an
  // unwritten plan to "annual". The "prices the plan the buyer chose" test
  // below cannot catch this: it supplies the plan by mocking readPendingSignup
  // directly, so it exercises only the read path and is structurally blind to
  // whether anything ever wrote the field in the first place.
  it("stashes the plan the buyer chose, not just the firm details", async () => {
    await saveSignupProfile({
      firmName: "Acme Wealth",
      advisorName: "Dana Reed",
      primaryColor: null,
      plan: "monthly",
    });
    expect(mockWrite).toHaveBeenCalledWith("user_buyer", {
      firmName: "Acme Wealth",
      advisorName: "Dana Reed",
      primaryColor: null,
      plan: "monthly",
    });
  });

  it("rejects a colour that is not a hex", async () => {
    const res = await saveSignupProfile({ firmName: "Acme", advisorName: "Dana", primaryColor: "rebeccapurple", plan: "annual" });
    expect(res.ok).toBe(false);
  });

  it("turns away someone who already has a workspace", async () => {
    mockAuth.mockResolvedValue({ userId: "user_buyer", orgId: "org_1" });
    const res = await saveSignupProfile({ firmName: "Acme", advisorName: "Dana", primaryColor: null, plan: "annual" });
    expect(res).toEqual({ ok: false, error: "You already have a workspace." });
  });

  // R14: writePendingSignup makes two unguarded Clerk API calls and has no
  // internal fail-soft recovery (unlike readPendingSignup, which is
  // explicitly documented fail-soft). Left bare, a rejection here throws out
  // of the server action and takes the whole page down via the error
  // boundary — losing the firm name the buyer just typed. This awaits the
  // action directly rather than wrapping it in expect(...).resolves: if the
  // try/catch were removed, `await saveSignupProfile(...)` itself would
  // reject and this test would fail, not merely see a different value.
  it("returns an inline error instead of throwing when the stash write fails", async () => {
    mockWrite.mockRejectedValueOnce(new Error("clerk down"));
    const res = await saveSignupProfile({ firmName: "Acme", advisorName: "Dana", primaryColor: null, plan: "annual" });
    expect(res).toEqual({ ok: false, error: "Could not save your details. Please try again." });
  });
});

describe("uploadSignupLogo", () => {
  function pngFormData(): FormData {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const fd = new FormData();
    fd.set("file", new File([png], "logo.png", { type: "image/png" }));
    return fd;
  }

  it("stores the logo under the buyer's signup prefix and stashes its URL", async () => {
    mockPutSignupAsset.mockResolvedValue({ url: "https://blob.example/logo.png" });
    const res = await uploadSignupLogo(pngFormData());
    expect(mockPutSignupAsset).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_buyer", kind: "logo", contentType: "image/png" }),
    );
    expect(mockWrite).toHaveBeenCalledWith("user_buyer", { logoUrl: "https://blob.example/logo.png" });
    expect(res).toEqual({ ok: true, url: "https://blob.example/logo.png" });
  });

  it("rejects a file whose bytes don't match its claimed type", async () => {
    const fd = new FormData();
    fd.set("file", new File([Buffer.from("not an image")], "x.png", { type: "image/png" }));
    const res = await uploadSignupLogo(fd);
    expect(res.ok).toBe(false);
    expect(mockPutSignupAsset).not.toHaveBeenCalled();
  });

  it("surfaces a storage failure inline instead of crashing the page", async () => {
    mockPutSignupAsset.mockRejectedValue(new Error("blob down"));
    const res = await uploadSignupLogo(pngFormData());
    expect(res).toEqual({ ok: false, error: "Upload failed. Please try again." });
  });

  // R14: the blob is already stored by the time writePendingSignup runs, so a
  // rejection here would otherwise either throw out of the server action
  // (unguarded) or, if swallowed carelessly, return ok: true for a logo the
  // profile never actually references — stranding it invisibly. Awaits the
  // action directly (not wrapped in expect(...).resolves) so removing the
  // try/catch fails this test via a rejected promise, not a value mismatch.
  it("returns an inline error instead of throwing when the stash write fails after a successful upload", async () => {
    mockPutSignupAsset.mockResolvedValue({ url: "https://blob.example/logo.png" });
    mockWrite.mockRejectedValueOnce(new Error("clerk down"));
    const res = await uploadSignupLogo(pngFormData());
    expect(res).toEqual({ ok: false, error: "Upload failed. Please try again." });
  });
});

describe("startSignupCheckout", () => {
  beforeEach(() => {
    mockRead.mockResolvedValue({
      firmName: "Acme Wealth", advisorName: "Dana Reed", plan: "annual",
      primaryColor: null, logoUrl: null, updatedAt: "2026-08-31T00:00:00.000Z",
    });
    mockCreateSession.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  });

  it("puts the Clerk userId on the session so the webhook knows who paid", async () => {
    await startSignupCheckout();
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference_id: "user_buyer" }),
    );
  });

  it("prices the plan the buyer chose", async () => {
    mockRead.mockResolvedValue({
      firmName: "Acme", advisorName: "Dana", plan: "monthly",
      primaryColor: null, logoUrl: null, updatedAt: "",
    });
    await startSignupCheckout();
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: "price_monthly", quantity: 1 }] }),
    );
  });

  it("refuses when no profile has been saved yet", async () => {
    mockRead.mockResolvedValue(null);
    const res = await startSignupCheckout();
    expect(res.ok).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("fails closed when the rate limiter says no", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, reason: "limited" });
    const res = await startSignupCheckout();
    expect(res.ok).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the user, not an IP — this path is authenticated", async () => {
    await startSignupCheckout();
    expect(mockRateLimit).toHaveBeenCalledWith("user:user_buyer");
  });
});
