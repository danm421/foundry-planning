// src/app/api/integrations/[provider]/connect/route.test.ts
import { it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/integrations/connections", () => ({
  upsertByokConnection: vi.fn(),
  createOauthState: vi.fn(),            // imported by GET in the same module
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
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
import { upsertByokConnection } from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAuth = auth as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTestConnection = testAddeparConnection as any;

function req(body: unknown) {
  return new Request("http://x/api/integrations/addepar/connect", {
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

it("rejects when attestation is not checked", async () => {
  const res = await POST(req({ ...good, attestation: false }), ctx);
  expect(res.status).toBe(400);
  expect(upsertByokConnection).not.toHaveBeenCalled();
});

it("404s when the provider flag is off", async () => {
  delete process.env.ADDEPAR_ENABLED;
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(404);
});

it("returns 400 when the credential test fails", async () => {
  mockTestConnection.mockRejectedValueOnce(new Error("401"));
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(400);
  expect(upsertByokConnection).not.toHaveBeenCalled();
});

it("validates credentials, stores them, audits, and 200s", async () => {
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(200);
  expect(testAddeparConnection).toHaveBeenCalled();
  expect(upsertByokConnection).toHaveBeenCalledWith(
    expect.objectContaining({ firmId: "firm_1", providerId: "addepar", userId: "u1" }),
  );
  expect(recordAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "integration.connect", metadata: { provider: "addepar" } }),
  );
});
