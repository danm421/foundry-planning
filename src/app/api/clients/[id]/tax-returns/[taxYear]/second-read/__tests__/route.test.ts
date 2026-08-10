import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requireOrgId: vi.fn(), requireActiveSubscription: vi.fn(), auth: vi.fn(),
  verifyClientAccess: vi.fn(), checkImportRateLimit: vi.fn(), recordAudit: vi.fn(),
  getTaxReturn: vi.fn(), assembleTaxAnalysis: vi.fn(),
  loadDocumentSourceText: vi.fn(), generateSecondRead: vi.fn(),
  putSecondRead: vi.fn(), dismissSecondReadItem: vi.fn(),
  listDocuments: vi.fn(),
}));

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: h.requireOrgId };
});
vi.mock("@/lib/authz", () => ({ requireActiveSubscription: h.requireActiveSubscription }));
vi.mock("@clerk/nextjs/server", () => ({ auth: h.auth }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: h.verifyClientAccess }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: h.checkImportRateLimit }));
vi.mock("@/lib/audit", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/tax-returns/store", () => ({ getTaxReturn: h.getTaxReturn }));
vi.mock("@/lib/tax-returns/documents-store", () => ({ listDocuments: h.listDocuments }));
vi.mock("@/lib/tax-returns/assemble-analysis", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/assemble-analysis")>(
    "@/lib/tax-returns/assemble-analysis",
  );
  return { ...actual, assembleTaxAnalysis: h.assembleTaxAnalysis };
});
vi.mock("@/lib/tax-returns/second-read/source-text", () => ({
  loadDocumentSourceText: h.loadDocumentSourceText,
}));
vi.mock("@/lib/tax-returns/second-read/generate", () => ({ generateSecondRead: h.generateSecondRead }));
vi.mock("@/lib/tax-returns/second-read/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/second-read/store")>(
    "@/lib/tax-returns/second-read/store",
  );
  return { ...actual, putSecondRead: h.putSecondRead, dismissSecondReadItem: h.dismissSecondReadItem };
});

import { NextRequest } from "next/server";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { POST } from "../route";
import { DELETE } from "../[itemId]/route";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const RETURN_ID = "33333333-3333-3333-3333-333333333333";

const READ = {
  generatedAt: "2026-08-10T12:00:00.000Z", warnings: [],
  items: [{ id: "sr-1", headline: "h", detail: "d", form: null, line: null, quotedValue: null, dismissed: false }],
};

function req() {
  return new NextRequest("http://localhost/api/x", { method: "POST" });
}
function ctx(): { params: Promise<{ id: string; taxYear: string }> };
function ctx<T extends Record<string, string>>(
  extra: T,
): { params: Promise<{ id: string; taxYear: string } & T> };
function ctx(extra?: Record<string, string>) {
  return { params: Promise.resolve({ id: CLIENT, taxYear: "2024", ...extra }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgId.mockResolvedValue("firm-1");
  h.requireActiveSubscription.mockResolvedValue(undefined);
  h.auth.mockResolvedValue({
    userId: "user-1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  });
  h.verifyClientAccess.mockResolvedValue({ ok: true, access: "own", permission: "edit" });
  h.checkImportRateLimit.mockResolvedValue({ allowed: true });
  h.getTaxReturn.mockResolvedValue({ id: RETURN_ID, taxYear: 2024 });
  h.listDocuments.mockResolvedValue([
    { id: "d1", role: "full_return", filename: "1040.pdf", vaultDocumentId: "v1" },
  ]);
  h.assembleTaxAnalysis.mockResolvedValue({
    facts: emptyTaxReturnFacts(2024),
    analysis: { findings: [{ headline: "Roth conversion headroom remains" }] },
  });
  h.loadDocumentSourceText.mockResolvedValue({
    sources: [{ documentId: "d1", role: "full_return", filename: "1040.pdf", text: "Form 1040" }],
    warnings: [],
  });
  h.generateSecondRead.mockResolvedValue(READ);
  h.dismissSecondReadItem.mockResolvedValue({
    ...READ, items: [{ ...READ.items[0], dismissed: true }],
  });
});

describe("POST second-read", () => {
  it("generates, persists, and returns the read", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secondRead: READ, secondReadStale: false });
    expect(h.putSecondRead).toHaveBeenCalledWith(RETURN_ID, READ, expect.any(String));
  });

  it("passes the fired findings' headlines to the generator so it can avoid them", async () => {
    await POST(req(), ctx());
    expect(h.generateSecondRead).toHaveBeenCalledWith(
      expect.objectContaining({ findingHeadlines: ["Roth conversion headroom remains"] }),
    );
  });

  it("audits the run", async () => {
    await POST(req(), ctx());
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tax_return.second_read", clientId: CLIENT }),
    );
  });

  it("403s without the ai_import entitlement", async () => {
    h.auth.mockResolvedValue({ userId: "user-1", sessionClaims: { org_public_metadata: { entitlements: [] } } });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("ai_import_not_entitled");
    expect(h.generateSecondRead).not.toHaveBeenCalled();
  });

  it("403s on read-only access", async () => {
    h.verifyClientAccess.mockResolvedValue({ ok: true, access: "own", permission: "view" });
    expect((await POST(req(), ctx())).status).toBe(403);
  });

  it("404s on an unknown client", async () => {
    h.verifyClientAccess.mockResolvedValue({ ok: false });
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("404s when the year does not exist", async () => {
    h.getTaxReturn.mockResolvedValue(null);
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("400s on an unparseable year", async () => {
    expect((await POST(req(), ctx({ taxYear: "nope" }))).status).toBe(400);
  });

  it("429s when rate limited", async () => {
    h.checkImportRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded" });
    expect((await POST(req(), ctx())).status).toBe(429);
    expect(h.generateSecondRead).not.toHaveBeenCalled();
  });

  it("502s and persists NOTHING when the AI call fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.generateSecondRead.mockRejectedValue(new Error("azure 500"));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(502);
    expect(h.putSecondRead).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith("second read generation failed:", expect.any(Error));
    errSpy.mockRestore();
  });

  it("409s with no readable figures when the year has no facts yet", async () => {
    h.assembleTaxAnalysis.mockResolvedValue({ facts: null });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This year has no readable figures yet.");
  });

  it("409s with not_converted when the return has no state row instead of creating one", async () => {
    const { MissingTaxReturnStateError } = await vi.importActual<typeof import("@/lib/tax-returns/errors")>(
      "@/lib/tax-returns/errors",
    );
    h.putSecondRead.mockRejectedValue(new MissingTaxReturnStateError(RETURN_ID));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_converted");
  });
});

describe("DELETE second-read item", () => {
  it("dismisses the item and returns the updated read", async () => {
    const res = await DELETE(req(), ctx({ itemId: "sr-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).secondRead.items[0].dismissed).toBe(true);
    expect(h.dismissSecondReadItem).toHaveBeenCalledWith(RETURN_ID, "sr-1");
  });

  it("404s when the item is not in the stored read", async () => {
    h.dismissSecondReadItem.mockResolvedValue(null);
    expect((await DELETE(req(), ctx({ itemId: "sr-99" }))).status).toBe(404);
  });

  it("403s on read-only access", async () => {
    h.verifyClientAccess.mockResolvedValue({ ok: true, access: "own", permission: "view" });
    expect((await DELETE(req(), ctx({ itemId: "sr-1" }))).status).toBe(403);
  });

  it("does NOT require the ai_import entitlement — dismissing makes no AI call", async () => {
    h.auth.mockResolvedValue({ userId: "user-1", sessionClaims: { org_public_metadata: { entitlements: [] } } });
    expect((await DELETE(req(), ctx({ itemId: "sr-1" }))).status).toBe(200);
  });

  it("audits the dismissal", async () => {
    await DELETE(req(), ctx({ itemId: "sr-1" }));
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tax_return.second_read_dismiss",
        clientId: CLIENT,
        metadata: expect.objectContaining({ itemId: "sr-1" }),
      }),
    );
  });

  it("does NOT audit when there is nothing to dismiss", async () => {
    h.dismissSecondReadItem.mockResolvedValue(null);
    await DELETE(req(), ctx({ itemId: "sr-99" }));
    expect(h.recordAudit).not.toHaveBeenCalled();
  });
});
