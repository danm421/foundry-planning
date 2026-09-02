// src/app/api/integrations/[provider]/households/claim/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkIntegrationClaimLimit: vi.fn(),
}));
vi.mock("@/lib/integrations/auth", () => ({ makeCallContext: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({ claimHousehold: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkIntegrationClaimLimit } from "@/lib/rate-limit";
import { makeCallContext } from "@/lib/integrations/auth";
import { claimHousehold } from "@/lib/integrations/households";
import { recordAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const saved = process.env.ADDEPAR_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (requireClientEditAccess as any).mockResolvedValue({
    client: { id: "c1" }, firmId: "firm_1", access: "own",
  });
  (checkIntegrationClaimLimit as any).mockResolvedValue({ allowed: true });
  (makeCallContext as any).mockResolvedValue({});
  (claimHousehold as any).mockResolvedValue({ ok: true, name: "Doe Family" });
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = saved;
});

const ctx = { params: Promise.resolve({ provider: "addepar" }) };
const post = (body: unknown) =>
  new Request("https://app.test/api/integrations/addepar/households/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
const good = { clientId: "c1", externalHouseholdId: "1234567" };

describe("POST …/households/claim", () => {
  it("lets a NON-ADMIN advisor with edit access claim", async () => {
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, name: "Doe Family" });
  });

  it("403s when the caller lacks edit access, without calling the provider", async () => {
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(403);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  it("403s a CROSS-FIRM shared client — a share is not integration access", async () => {
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(403);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the USER, not the firm", async () => {
    await POST(post(good), ctx);
    const key = (checkIntegrationClaimLimit as any).mock.calls[0][0] as string;
    expect(key).toContain("u1");
    expect(key).not.toContain("firm_1");
  });

  it("does not reach the provider when rate limited", async () => {
    (checkIntegrationClaimLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(429);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  // THE load-bearing test: the two failure reasons must be indistinguishable.
  it("returns a BYTE-IDENTICAL response for unknown vs already-linked", async () => {
    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "unknown_household" });
    const a = await POST(post(good), ctx);
    const aBody = await a.text();

    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "already_linked" });
    const b = await POST(post(good), ctx);
    const bBody = await b.text();

    expect(a.status).toBe(b.status);
    expect(a.status).toBe(409);
    expect(aBody).toBe(bBody);
  });

  it("audits the TRUE reason even though the caller sees the opaque one", async () => {
    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "already_linked" });
    await POST(post(good), ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.household.claim",
        clientId: "c1",
        firmId: "firm_1",
        metadata: expect.objectContaining({ outcome: "already_linked" }),
      }),
    );
  });

  it("audits a successful claim too", async () => {
    await POST(post(good), ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.household.claim",
        metadata: expect.objectContaining({ outcome: "ok" }),
      }),
    );
  });

  it("400s a missing household id without spending the rate limit", async () => {
    const res = await POST(post({ clientId: "c1" }), ctx);
    expect(res.status).toBe(400);
    expect(checkIntegrationClaimLimit).not.toHaveBeenCalled();
  });

  it("404s when the provider flag is off", async () => {
    delete process.env.ADDEPAR_ENABLED;
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(404);
  });
});
