// src/app/api/clients/[id]/imports/[importId]/files/upload-token/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: vi.fn().mockResolvedValue("firm1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, access: "own", permission: "edit", firmId: "firm1" }) }));
vi.mock("@/lib/imports/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/imports/authz")>()), requireImportAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/authz")>()), requireActiveSubscription: vi.fn() }));

const mockGenerateClientToken = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => mockGenerateClientToken(...args),
}));

import { POST } from "../route";
import { requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { ForbiddenError as SubscriptionForbiddenError, requireActiveSubscription } from "@/lib/authz";

const ctx = { params: Promise.resolve({ id: "c1", importId: "imp1" }) };
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: "u1", saved: [], leftOut: [] };

const ask = (body: unknown) =>
  new NextRequest("http://x/api/clients/c1/imports/imp1/files/upload-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const importWith = (payloadJson: unknown) => ({ id: "imp1", payloadJson }) as Awaited<ReturnType<typeof requireImportAccess>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateClientToken.mockResolvedValue("client-token");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
});

describe("POST /imports/[importId]/files/upload-token", () => {
  it("issues a token under staging/imports/<clientId>/ capped at 20 MB", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(null));
    const res = await POST(ask({ filename: "stmt.pdf" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientToken).toBe("client-token");
    expect(body.pathname).toMatch(/^staging\/imports\/c1\/\d+-[0-9a-f-]{36}-stmt\.pdf$/);
    expect(mockGenerateClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: body.pathname, maximumSizeInBytes: 20 * 1024 * 1024 }),
    );
  });

  it("refuses a saved fact-finder import with 409 and issues nothing", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith({ factFinder: { version: 3, closed: CLOSED } }));
    const res = await POST(ask({ filename: "stmt.pdf" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(SAVE_CLOSED_MESSAGE);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("refuses a lapsed subscription with 403 and issues nothing", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(new SubscriptionForbiddenError("Active subscription required"));
    const res = await POST(ask({ filename: "stmt.pdf" }), ctx);
    expect(res.status).toBe(403);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("is held to the upload rate limit", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "exceeded" } as Awaited<ReturnType<typeof checkImportRateLimit>>);
    const res = await POST(ask({ filename: "stmt.pdf" }), ctx);
    expect(res.status).toBe(429);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });

  it("answers 400 to a body with no filename", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(null));
    const res = await POST(ask({}), ctx);
    expect(res.status).toBe(400);
    expect(mockGenerateClientToken).not.toHaveBeenCalled();
  });
});
