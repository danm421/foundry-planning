// src/lib/fact-finder/__tests__/gate-for.test.ts
// The connector's doorway to the fact finder gate: the same chain as the
// session's (pinned in gate.test.ts), with the identity, the firm and the
// `ai_import` entitlement read from the principal — never from a Clerk session.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>("@/lib/imports/authz");
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn(), verifyClientAccessFor: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { auth } from "@clerk/nextjs/server";
import { requireActiveSubscription } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess, verifyClientAccessFor } from "@/lib/clients/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireImportAccess } from "@/lib/imports/authz";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { SAVE_CLOSED_MESSAGE } from "../api-types";
import { factFinderGateFor } from "../gate";

const PRINCIPAL: McpPrincipal = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:admin",
  scopes: [],
  tokenSubject: "user_1",
  canWrite: true,
  entitlements: ["ai_import"],
};
const IMPORT = { id: "i1", status: "draft", payloadJson: { factFinder: { version: 2 } }, createdByUserId: "user_1" };
const OWN_EDIT = { ok: true, permission: "edit", firmId: "org_1", access: "own" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyClientAccessFor).mockResolvedValue(OWN_EDIT);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true, remaining: 1, reset: 0 } as never);
  vi.mocked(requireImportAccess).mockResolvedValue(IMPORT as never);
});

describe("factFinderGateFor", () => {
  it("lets the principal's own client's fact finder import through, on the principal and never the session", async () => {
    const gate = await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit");
    expect(gate).toEqual({
      ok: true,
      firmId: "org_1",
      userId: "user_1",
      clientId: "c1",
      importId: "i1",
      imp: IMPORT,
      payloadJson: IMPORT.payloadJson,
    });
    expect(verifyClientAccessFor).toHaveBeenCalledWith(PRINCIPAL, "c1");
    expect(checkImportRateLimit).toHaveBeenCalledWith("org_1", "edit");
    expect(requireImportAccess).toHaveBeenCalledWith({ importId: "i1", clientId: "c1", firmId: "org_1", userId: "user_1" });
    expect(auth).not.toHaveBeenCalled();
    expect(requireOrgId).not.toHaveBeenCalled();
    expect(verifyClientAccess).not.toHaveBeenCalled();
    // Billing for a connector write is the tool runner's check (`principal.canWrite`).
    expect(requireActiveSubscription).not.toHaveBeenCalled();
  });

  it("refuses view-only access and a shared client with the session gate's answers, before the rate limit", async () => {
    vi.mocked(verifyClientAccessFor).mockResolvedValueOnce({ ok: true, permission: "view", firmId: "org_1", access: "own" });
    expect(await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit")).toEqual({
      ok: false,
      status: 403,
      body: { error: "View-only access" },
    });
    // A share — view-only or not — is refused as cross-organization first, as the session gate does.
    vi.mocked(verifyClientAccessFor).mockResolvedValueOnce({ ok: true, permission: "view", firmId: "org_2", access: "shared" });
    expect(await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit")).toEqual({
      ok: false,
      status: 403,
      body: { error: "Cross-organization imports are not supported." },
    });
    vi.mocked(verifyClientAccessFor).mockResolvedValueOnce({ ok: false });
    expect(await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit")).toEqual({ ok: false, status: 404, body: { error: "Not found" } });
    expect(checkImportRateLimit).not.toHaveBeenCalled();
  });

  it("403s a firm without the AI import entitlement and audits the refusal as the advisor", async () => {
    const gate = await factFinderGateFor({ ...PRINCIPAL, entitlements: [] }, "c1", "i1", "edit");
    expect(gate).toEqual({ ok: false, status: 403, body: { error: "ai_import_not_entitled" } });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "billing.access_denied",
      resourceType: "firm",
      resourceId: "org_1",
      clientId: "c1",
      firmId: "org_1",
      actorId: "user_1",
      metadata: { reason: "ai_import_not_entitled", importId: "i1", via: "claude" },
    });
    expect(auth).not.toHaveBeenCalled();
  });

  it("refuses an edit to a saved import with the saved fact finder, and still lets the view through", async () => {
    const closed = { at: "2026-10-15T12:00:00.000Z", by: "user_1", saved: [], leftOut: [] };
    const saved = { ...IMPORT, status: "committed", payloadJson: { factFinder: { version: 5, closed } } };
    vi.mocked(requireImportAccess).mockResolvedValueOnce(saved as never);
    expect(await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit")).toMatchObject({
      ok: false,
      status: 409,
      body: { error: SAVE_CLOSED_MESSAGE, factFinder: { version: 5, closed } },
    });
    vi.mocked(requireImportAccess).mockResolvedValueOnce(saved as never);
    expect((await factFinderGateFor(PRINCIPAL, "c1", "i1", "view")).ok).toBe(true);
  });

  it("hands back the rate limit's refusal with its Retry-After header", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "exceeded", remaining: 0, reset: Date.now() + 5000 } as never);
    const gate = await factFinderGateFor(PRINCIPAL, "c1", "i1", "edit");
    expect(gate).toMatchObject({ ok: false, status: 429, body: { error: "Too many requests. Please wait a moment and try again." } });
    if (gate.ok) throw new Error("expected a refusal");
    expect(Number(gate.headers?.["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(requireImportAccess).not.toHaveBeenCalled();
  });
});
