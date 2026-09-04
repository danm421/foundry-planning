import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_1"), requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "org_1", userId: "user_1" }) };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "org_1", access: "own" }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tax-reconciliation/reconcile", () => ({ computeReconciliation: vi.fn() }));
vi.mock("@/lib/tax-reconciliation/apply", () => ({ applySuggestion: vi.fn() }));
vi.mock("@/lib/tax-reconciliation/dismissals-store", () => ({ addDismissal: vi.fn(), removeDismissal: vi.fn() }));

import { UnauthorizedError } from "@/lib/db-helpers";
import { ForbiddenError } from "@/lib/authz";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { computeReconciliation } from "@/lib/tax-reconciliation/reconcile";
import { applySuggestion } from "@/lib/tax-reconciliation/apply";
import { addDismissal, removeDismissal } from "@/lib/tax-reconciliation/dismissals-store";
import { recordAudit } from "@/lib/audit";
import { GET } from "../route";
import { POST as APPLY } from "../apply/route";
import { POST as DISMISS, DELETE as RESTORE } from "../dismiss/route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const params = { params: Promise.resolve({ id: CLIENT_ID, taxYear: "2025" }) };
const recon = { taxYear: 2025, planYear: 2026, sections: [], checks: [], dismissed: [], notes: [], overview: {} };
const json = (body: unknown, method = "POST") => new NextRequest("http://test", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeReconciliation).mockResolvedValue({ ok: true, taxReturnId: "tr-1", reconciliation: recon as never });
  vi.mocked(verifyClientAccess).mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" } as never);
  vi.mocked(requireClientEditAccess).mockResolvedValue({ firmId: "org_1", access: "own" } as never);
});

describe("GET …/reconcile", () => {
  it("returns the bundle, 404s a missing year, 409s a missing plan, 400s a bad year", async () => {
    let res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).reconciliation.taxYear).toBe(2025);
    expect(computeReconciliation).toHaveBeenCalledWith(CLIENT_ID, "org_1", 2025);
    vi.mocked(computeReconciliation).mockResolvedValueOnce({ ok: false, code: "not_found", message: "none" });
    expect((await GET(new NextRequest("http://test"), params)).status).toBe(404);
    vi.mocked(computeReconciliation).mockResolvedValueOnce({ ok: false, code: "no_plan", message: "no plan" });
    res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_plan", message: "no plan" });
    expect((await GET(new NextRequest("http://test"), { params: Promise.resolve({ id: CLIENT_ID, taxYear: "abc" }) })).status).toBe(400);
  });

  // Binding decision #3: every LOAD_FAILURE_STATUS arm gets pinned by its own
  // test — a mapping table that happens to pass on two codes can still be
  // wrong on the third.
  it("409s a facts_unreadable return distinctly from no_plan", async () => {
    vi.mocked(computeReconciliation).mockResolvedValueOnce({ ok: false, code: "facts_unreadable", message: "still extracting" });
    const res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "facts_unreadable", message: "still extracting" });
  });

  // A client that exists but isn't this caller's (or isn't shared to them) must 404
  // via the access check — a DIFFERENT branch than computeReconciliation's own
  // not_found, and one none of the mocks above happen to exercise.
  it("404s when verifyClientAccess denies the caller, before computeReconciliation runs", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Client not found" });
    expect(computeReconciliation).not.toHaveBeenCalled();
  });

  it("401s when the caller has no session", async () => {
    const { requireOrgId } = await import("@/lib/db-helpers");
    vi.mocked(requireOrgId).mockRejectedValueOnce(new UnauthorizedError());
    const res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(401);
  });
});

describe("POST …/reconcile/apply", () => {
  it("passes only suggestionId/amount/owner to the applier with the caller's identity", async () => {
    vi.mocked(applySuggestion).mockResolvedValue({ ok: true, applied: { suggestionId: "s", summary: "done" }, reconciliation: recon as never });
    const res = await APPLY(json({ suggestionId: "income.wages.w2.0", amount: 1, owner: "client", target: { kind: "client.update" } }), params);
    expect(res.status).toBe(200);
    expect(applySuggestion).toHaveBeenCalledWith({ clientId: CLIENT_ID, firmId: "org_1", actorId: "user_1", callerOrgId: "org_1", taxYear: 2025, suggestionId: "income.wages.w2.0", amount: 1, owner: "client" });
  });

  it("400s a malformed body and maps applier failures to their status, carrying the stale bundle", async () => {
    expect((await APPLY(json({ amount: 1 }), params)).status).toBe(400);
    expect((await APPLY(json({ suggestionId: "x", owner: "everyone" }), params)).status).toBe(400);
    vi.mocked(applySuggestion).mockResolvedValueOnce({ ok: false, status: 409, error: "stale", reconciliation: recon as never });
    const res = await APPLY(json({ suggestionId: "x" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale", reconciliation: { taxYear: 2025 } });
  });

  // Ruling R91 / binding decision #2: the applier's two failure shapes are deliberately
  // different — a firm mismatch is a returned {ok:false, status:404}, while no-access
  // and no-subscription THROW ForbiddenError. Both must reach the advisor as their real
  // status, never fall through the route's generic catch to a 500.
  it("maps the applier's returned firm-mismatch failure to 404 with no reconciliation body", async () => {
    vi.mocked(applySuggestion).mockResolvedValueOnce({ ok: false, status: 404, error: "Client not found" });
    const res = await APPLY(json({ suggestionId: "x" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Client not found" });
  });

  it("maps a ForbiddenError thrown by the applier's own gate to 403, not 500", async () => {
    vi.mocked(applySuggestion).mockRejectedValueOnce(new ForbiddenError("Active subscription required"));
    const res = await APPLY(json({ suggestionId: "x" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Active subscription required" });
  });
});

describe("dismiss / restore", () => {
  it("dismisses, audits, and returns the recomputed bundle; 503s in the migration window", async () => {
    vi.mocked(addDismissal).mockResolvedValue("ok");
    const res = await DISMISS(json({ suggestionId: "tax.federal" }), params);
    expect(res.status).toBe(200);
    expect(addDismissal).toHaveBeenCalledWith("tr-1", "tax.federal", "user_1");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tax_reconciliation.dismiss", metadata: expect.objectContaining({ suggestionId: "tax.federal" }) }));
    expect(computeReconciliation).toHaveBeenCalledTimes(2);
    vi.mocked(addDismissal).mockResolvedValueOnce("unavailable");
    expect((await DISMISS(json({ suggestionId: "tax.federal" }), params)).status).toBe(503);
  });

  it("restores with DELETE", async () => {
    vi.mocked(removeDismissal).mockResolvedValue("ok");
    const res = await RESTORE(json({ suggestionId: "tax.federal" }, "DELETE"), params);
    expect(res.status).toBe(200);
    expect(removeDismissal).toHaveBeenCalledWith("tr-1", "tax.federal");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tax_reconciliation.restore" }));
  });

  it("400s a body with no suggestionId, before touching the store", async () => {
    const res = await DISMISS(json({}), params);
    expect(res.status).toBe(400);
    expect(addDismissal).not.toHaveBeenCalled();
  });

  // The same LOAD_FAILURE_STATUS table GET uses, but exercised through dismiss's own
  // early-return so a broken import or a skipped check here specifically reddens.
  it("maps a load failure on the pre-write compute to its status, before dismissing anything", async () => {
    vi.mocked(computeReconciliation).mockResolvedValueOnce({ ok: false, code: "not_found", message: "none" });
    const res = await DISMISS(json({ suggestionId: "tax.federal" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "none" });
    expect(addDismissal).not.toHaveBeenCalled();
  });

  it("maps a ForbiddenError thrown by its own gate to 403, not 500", async () => {
    const { requireActiveSubscriptionForFirm } = await import("@/lib/authz");
    vi.mocked(requireActiveSubscriptionForFirm).mockRejectedValueOnce(new ForbiddenError("Active subscription required"));
    const res = await DISMISS(json({ suggestionId: "tax.federal" }), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Active subscription required" });
  });
});
