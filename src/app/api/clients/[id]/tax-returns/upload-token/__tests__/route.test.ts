import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
const mockGenerateClientToken = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => mockGenerateClientToken(...args),
}));

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { POST } from "../route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const params = { params: Promise.resolve({ id: CLIENT_ID }) };

const postJson = (body: unknown) =>
  new NextRequest(`http://test/api/clients/${CLIENT_ID}/tax-returns/upload-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true, permission: "edit", firmId: "org_1", access: "own",
  } as never);
  mockGenerateClientToken.mockResolvedValue("client-token");
});

describe("POST /api/clients/[id]/tax-returns/upload-token", () => {
  it("issues a 50 MB token for a fresh pathname in this client's staging folder", async () => {
    const res = await POST(postJson({ filename: "McCormick 1040.pdf" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.clientToken).toBe("client-token");
    expect(json.pathname).toMatch(
      new RegExp(`^staging/tax-returns/${CLIENT_ID}/\\d+-[0-9a-f-]{36}-McCormick_1040\\.pdf$`),
    );
    expect(mockGenerateClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: json.pathname, maximumSizeInBytes: 50 * 1024 * 1024 }),
    );
  });

  it("404s a client the advisor can't see", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false } as never);
    const res = await POST(postJson({ filename: "r.pdf" }), params);
    expect(res.status).toBe(404);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("403s on read-only access", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true, permission: "view", firmId: "org_1", access: "own",
    } as never);
    const res = await POST(postJson({ filename: "r.pdf" }), params);
    expect(res.status).toBe(403);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("403s and audits without the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1", sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(postJson({ filename: "r.pdf" }), params);
    expect(res.status).toBe(403);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "billing.access_denied" }));
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("400s without a filename", async () => {
    const res = await POST(postJson({ filename: "  " }), params);
    expect(res.status).toBe(400);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });
});
