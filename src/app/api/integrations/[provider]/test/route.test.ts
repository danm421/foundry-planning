// src/app/api/integrations/[provider]/test/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: vi.fn(),       // no-op resolve = authorized
  authErrorResponse: vi.fn(() => null),  // not an auth error
}));
vi.mock("@/lib/integrations/providers/addepar/client", () => ({
  testAddeparConnection: vi.fn(),        // resolves = credentials valid
  addeparClient: {},                     // referenced at module scope by providers/addepar/index.ts
}));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationOauthLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import { CredentialsRejected } from "@/lib/integrations/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAuth = auth as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTestConnection = testAddeparConnection as any;

function req(body: unknown) {
  return new Request("http://x/api/integrations/addepar/test", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ provider: "addepar" }) };
const good = { apiBase: "https://api.addepar.com", addeparFirmId: "42", apiKey: "k", apiSecret: "s" };

let saved: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  saved = process.env.ADDEPAR_ENABLED;
  process.env.ADDEPAR_ENABLED = "true";
  mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = saved;
});

describe("[provider] test", () => {
  it("returns 400 for an invalid body", async () => {
    const res = await POST(req({ apiBase: "not-a-url" }), ctx);
    expect(res.status).toBe(400);
  });

  it("returns { ok: true } for valid credentials", async () => {
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(testAddeparConnection).toHaveBeenCalled();
  });

  it("returns 400 when testAddeparConnection rejects", async () => {
    mockTestConnection.mockRejectedValueOnce(new Error("401"));
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(400);
  });

  it("tells the admin to check the key and secret when Addepar rejects them", async () => {
    mockTestConnection.mockRejectedValueOnce(new CredentialsRejected("Check the API key, secret and firm ID."));
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Check the API key, secret and firm ID." });
  });

  it("keeps a non-credential failure's internals out of the message", async () => {
    mockTestConnection.mockRejectedValueOnce(new Error("Addepar /v1/groups failed: 500"));
    const res = await POST(req(good), ctx);
    expect((await res.json()).error).not.toMatch(/500/);
  });

  it("404s when the provider flag is off", async () => {
    delete process.env.ADDEPAR_ENABLED;
    const res = await POST(req(good), ctx);
    expect(res.status).toBe(404);
  });
});
