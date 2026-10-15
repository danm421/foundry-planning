// src/lib/fact-finder/__tests__/gate.test.ts
// The whole gate order, pinned once here; each route's test mocks the gate and
// checks only its bucket and what it does after.
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
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));

import { auth } from "@clerk/nextjs/server";
import { ForbiddenError as SubscriptionForbiddenError, requireActiveSubscription } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError, NotFoundError, requireImportAccess } from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { SAVE_CLOSED_MESSAGE } from "../api-types";
import { factFinderGate } from "../gate";

const params = () => Promise.resolve({ id: "c1", importId: "i1" });
const ENTITLED = { org_public_metadata: { entitlements: ["ai_import"] } };
const IMPORT = { id: "i1", payloadJson: { chat: { surface: "chat" } }, createdByUserId: "user_1" };

/** Each check, in the order it ran. */
const ran: string[] = [];
const step = <T>(name: string, value: T) => async () => {
  ran.push(name);
  return value;
};

async function refusal(op: Parameters<typeof factFinderGate>[1] = "turn") {
  const gate = await factFinderGate(params(), op);
  if (gate.ok) throw new Error("expected a refusal");
  return { status: gate.response.status, body: await gate.response.json(), headers: gate.response.headers };
}

beforeEach(() => {
  vi.clearAllMocks();
  ran.length = 0;
  vi.mocked(requireOrgId).mockImplementation(step("org", "org_1"));
  vi.mocked(requireActiveSubscription).mockImplementation(step("subscription", undefined));
  vi.mocked(auth).mockImplementation(step("auth", { userId: "user_1", sessionClaims: ENTITLED }) as never);
  vi.mocked(verifyClientAccess).mockImplementation(
    step("client", { ok: true, permission: "edit", firmId: "org_1", access: "own" }) as never,
  );
  vi.mocked(checkImportRateLimit).mockImplementation(step("rateLimit", { allowed: true, remaining: 1, reset: 0 }) as never);
  vi.mocked(requireImportAccess).mockImplementation(step("import", IMPORT) as never);
});

describe("factFinderGate", () => {
  it("runs org → subscription → auth → client access → rate limit → import, and hands back the import", async () => {
    const gate = await factFinderGate(params(), "turn");
    expect(gate).toEqual({
      ok: true,
      firmId: "org_1",
      userId: "user_1",
      clientId: "c1",
      importId: "i1",
      imp: IMPORT,
      payloadJson: IMPORT.payloadJson,
    });
    expect(ran).toEqual(["org", "subscription", "auth", "client", "rateLimit", "import"]);
    expect(checkImportRateLimit).toHaveBeenCalledWith("org_1", "turn");
    expect(requireImportAccess).toHaveBeenCalledWith({ importId: "i1", clientId: "c1", firmId: "org_1", userId: "user_1" });
  });

  it("401s without an org or a user", async () => {
    vi.mocked(requireOrgId).mockRejectedValueOnce(new UnauthorizedError("Organization context required"));
    expect(await refusal()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
    expect(ran).toEqual([]);

    vi.mocked(auth).mockImplementationOnce(step("auth", { userId: null }) as never);
    expect(await refusal()).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
    expect(ran).toEqual(["org", "subscription", "auth"]);
  });

  it("403s without a subscription, before auth, client access or the import", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(new SubscriptionForbiddenError("Active subscription required"));
    expect(await refusal()).toMatchObject({ status: 403, body: { error: "Active subscription required" } });
    expect(ran).toEqual(["org"]);
  });

  it("404s an unknown client and 403s a cross-firm or view-only one — all before spending the rate limit", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false });
    expect(await refusal()).toMatchObject({ status: 404, body: { error: "Not found" } });
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: true, permission: "edit", firmId: "org_2", access: "shared" } as never);
    expect(await refusal()).toMatchObject({ status: 403, body: { error: "Cross-organization imports are not supported." } });
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: true, permission: "view", firmId: "org_1", access: "own" } as never);
    expect(await refusal()).toMatchObject({ status: 403, body: { error: "View-only access" } });
    expect(checkImportRateLimit).not.toHaveBeenCalled();
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("fails closed at the rate limit, and a refused request never reaches the import", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "exceeded", remaining: 0, reset: Date.now() + 5000 } as never);
    const limited = await refusal();
    expect(limited).toMatchObject({ status: 429, body: { error: "Too many requests. Please wait a moment and try again." } });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "unconfigured" } as never);
    expect(await refusal()).toMatchObject({
      status: 503,
      body: { error: "Rate limiting is not configured — the fact finder import is disabled." },
    });
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({ allowed: false, reason: "redis_error" } as never);
    expect(await refusal()).toMatchObject({
      status: 503,
      body: { error: "Rate limiting is temporarily unavailable. Please retry in a moment." },
    });
    expect(requireImportAccess).not.toHaveBeenCalled();
  });

  it("403s an import the user can't open and 404s a missing one", async () => {
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new ForbiddenError());
    expect(await refusal()).toMatchObject({ status: 403, body: { error: "Forbidden" } });
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    expect(await refusal()).toMatchObject({ status: 404, body: { error: "Import not found" } });
  });

  it("403s a firm without the AI import entitlement, after the import check, and audits the refusal", async () => {
    vi.mocked(auth).mockImplementationOnce(step("auth", { userId: "user_1", sessionClaims: { org_public_metadata: { entitlements: [] } } }) as never);
    expect(await refusal()).toMatchObject({ status: 403, body: { error: "ai_import_not_entitled" } });
    expect(ran).toEqual(["org", "subscription", "auth", "client", "rateLimit", "import"]);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "billing.access_denied", firmId: "org_1" }));
  });

  it("400s an import that isn't a fact finder import, and lets one with a fact finder through", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ ...IMPORT, payloadJson: {} } as never);
    expect(await refusal()).toMatchObject({ status: 400, body: { error: "This import isn't a fact finder import." } });
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ ...IMPORT, payloadJson: { factFinder: { version: 1 } } } as never);
    expect((await factFinderGate(params(), "view")).ok).toBe(true);
  });

  it("refuses every op but view once the import is saved to the plan, with the saved fact finder, and still lets the view through", async () => {
    const closed = { at: "2026-10-15T12:00:00.000Z", by: "user_1", saved: [], leftOut: [] };
    const closedImport = { ...IMPORT, payloadJson: { factFinder: { version: 5, closed } } };
    for (const op of ["edit", "extract", "turn", "match", "commit"] as const) {
      vi.mocked(requireImportAccess).mockResolvedValueOnce(closedImport as never);
      // The saved fact finder rides on the refusal: a screen still open on it switches to the closed view.
      expect(await refusal(op)).toMatchObject({ status: 409, body: { error: SAVE_CLOSED_MESSAGE, factFinder: { version: 5, closed } } });
    }
    vi.mocked(requireImportAccess).mockResolvedValueOnce(closedImport as never);
    expect((await factFinderGate(params(), "view")).ok).toBe(true);
  });

  it("does not treat an open fact finder as closed", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ ...IMPORT, payloadJson: { factFinder: { version: 5 } } } as never);
    expect((await factFinderGate(params(), "commit")).ok).toBe(true);
  });
});
