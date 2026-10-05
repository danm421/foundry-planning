// src/lib/__tests__/forge-access.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ requireOrgId: vi.fn(), requireActiveSubscription: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: m.requireOrgId }));
vi.mock("@/lib/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/authz")>()), requireActiveSubscription: m.requireActiveSubscription }));
vi.mock("@clerk/nextjs/server", () => ({ auth: m.auth }));

import { forgeViewerGate } from "../forge-access";
import { UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";

const claims = (entitlements: string[]) => ({ userId: "u1", sessionClaims: { org_public_metadata: { entitlements } } });

beforeEach(() => {
  vi.stubEnv("FORGE_ENABLED", "true");
  m.requireOrgId.mockReset().mockResolvedValue("org_1");
  m.requireActiveSubscription.mockReset().mockResolvedValue(undefined);
  m.auth.mockReset().mockResolvedValue(claims(["ai_forge"]));
});

describe("forgeViewerGate", () => {
  it("lets a signed-in, subscribed, Forge-entitled user through", async () => {
    expect(await forgeViewerGate()).toBeNull();
  });

  it("404s when Forge is off", async () => {
    vi.stubEnv("FORGE_ENABLED", "");
    expect((await forgeViewerGate())?.status).toBe(404);
  });

  it("401s without an organization", async () => {
    m.requireOrgId.mockRejectedValue(new UnauthorizedError("Organization context required"));
    expect((await forgeViewerGate())?.status).toBe(401);
  });

  it("403s without an active subscription", async () => {
    m.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    expect((await forgeViewerGate())?.status).toBe(403);
  });

  it("401s without a user", async () => {
    m.auth.mockResolvedValue({ userId: null, sessionClaims: null });
    expect((await forgeViewerGate())?.status).toBe(401);
  });

  it("403s without the Forge entitlement", async () => {
    m.auth.mockResolvedValue(claims(["crm"]));
    expect((await forgeViewerGate())?.status).toBe(403);
  });
});
