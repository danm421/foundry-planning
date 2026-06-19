// src/app/api/integrations/orion/callback/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/orion/connections", () => ({
  consumeOauthState: vi.fn(),
  upsertConnection: vi.fn(),
}));
vi.mock("@/lib/orion/oauth", () => ({
  exchangeCodeForTokens: vi.fn().mockResolvedValue({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 }),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET } from "./route";
import { consumeOauthState, upsertConnection } from "@/lib/orion/connections";
import { auth } from "@clerk/nextjs/server";

beforeEach(() => vi.clearAllMocks());

function req(qs: string) {
  return new Request(`https://app.test/api/integrations/orion/callback?${qs}`);
}

describe("orion callback", () => {
  it("rejects an unknown/expired state (CSRF)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeOauthState as any).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=bad"));
    expect(res.status).toBe(400);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("rejects when session firm != state firm", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeOauthState as any).mockResolvedValue({ firmId: "firm_OTHER", userId: "u1", codeVerifier: "v" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=s"));
    expect(res.status).toBe(403);
    expect(upsertConnection).not.toHaveBeenCalled();
  });

  it("exchanges and stores on valid state", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (consumeOauthState as any).mockResolvedValue({ firmId: "firm_1", userId: "u1", codeVerifier: "v" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1" });
    const res = await GET(req("code=c&state=s"));
    expect([302, 307]).toContain(res.status); // redirect to settings
    expect(upsertConnection).toHaveBeenCalledWith(expect.objectContaining({ firmId: "firm_1", accessToken: "AT" }));
  });
});
