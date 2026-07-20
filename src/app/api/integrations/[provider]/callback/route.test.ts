// src/app/api/integrations/[provider]/callback/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/integrations/connections", () => ({
  consumeOauthState: vi.fn(),
  upsertConnection: vi.fn(),
}));
// Control the Orion oauth seam so `orionProvider.oauth.exchangeCodeForTokens`
// (resolved through the REAL registry) is deterministic. The registry itself
// is left unmocked so the isProviderId → getProvider → isEnabled gate runs.
vi.mock("@/lib/integrations/providers/orion/oauth", () => ({
  orionOAuth: {
    buildAuthorizeUrl: vi.fn(),
    exchangeCodeForTokens: vi
      .fn()
      .mockResolvedValue({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 }),
    refreshTokens: vi.fn(),
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET } from "./route";
import { consumeOauthState, upsertConnection } from "@/lib/integrations/connections";
import { orionOAuth } from "@/lib/integrations/providers/orion/oauth";
import { auth } from "@clerk/nextjs/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAuth = auth as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConsume = consumeOauthState as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExchange = orionOAuth.exchangeCodeForTokens as any;

let savedSchwabEnabled: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  savedSchwabEnabled = process.env.SCHWAB_ENABLED;
  process.env.SCHWAB_ENABLED = "true";
});
afterEach(() => {
  if (savedSchwabEnabled === undefined) delete process.env.SCHWAB_ENABLED;
  else process.env.SCHWAB_ENABLED = savedSchwabEnabled;
});

function req(qs: string, provider = "orion") {
  return new Request(`https://app.test/api/integrations/${provider}/callback?${qs}`);
}
function ctx(provider = "orion") {
  return { params: Promise.resolve({ provider }) };
}

describe("[provider] callback", () => {
  it("rejects an unknown/expired state (CSRF)", async () => {
    mockConsume.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=bad"), ctx());
    expect(res.status).toBe(400);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("rejects when session firm != state firm", async () => {
    mockConsume.mockResolvedValue({ firmId: "firm_OTHER", providerId: "orion", userId: "u1", codeVerifier: "v" });
    mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=s"), ctx());
    expect(res.status).toBe(403);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("exchanges and stores on valid state", async () => {
    mockConsume.mockResolvedValue({ firmId: "firm_1", providerId: "orion", userId: "u1", codeVerifier: "v" });
    mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=s"), ctx());
    expect([302, 307]).toContain(res.status); // redirect to settings
    expect(upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "firm_1", providerId: "orion", accessToken: "AT" }),
    );
  });

  it("redirects with error marker when token exchange fails", async () => {
    mockConsume.mockResolvedValue({ firmId: "firm_1", providerId: "orion", userId: "u1", codeVerifier: "v" });
    mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    mockExchange.mockRejectedValueOnce(new Error("invalid_grant"));
    const res = await GET(req("code=c&state=s"), ctx());
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("error=orion_exchange_failed");
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("rejects a callback whose route provider differs from the state's provider", async () => {
    // State was minted for Orion; complete it at the Schwab callback.
    mockConsume.mockResolvedValue({ firmId: "firm_1", providerId: "orion", userId: "u1", codeVerifier: "v" });
    mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(
      new Request("https://app.test/api/integrations/schwab/callback?code=c&state=st-1"),
      { params: Promise.resolve({ provider: "schwab" }) },
    );
    expect(res.status).toBe(400);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("404s for an unknown provider", async () => {
    const res = await GET(
      new Request("https://app.test/api/integrations/addepar/callback?code=c&state=s"),
      { params: Promise.resolve({ provider: "addepar" }) },
    );
    expect(res.status).toBe(404);
  });

  it("404s for a flag-disabled provider", async () => {
    delete process.env.SCHWAB_ENABLED;
    const res = await GET(
      new Request("https://app.test/api/integrations/schwab/connect"),
      { params: Promise.resolve({ provider: "schwab" }) },
    );
    expect(res.status).toBe(404);
  });
});
