import { describe, it, expect, vi, beforeEach } from "vitest";

// Task 11: the tax-analysis PDF export resolves branding via the client's
// OWN advisor (resolveBrandingForClient), not just the firm (old
// resolveBranding). Every dependency below is mocked EXCEPT that wiring, so
// the assertions exercise real behavior rather than mock behavior.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test", orgId: "firm_test" }),
  currentUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "advisor@firm.com" }] }),
}));

const dbSelectMock = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { select: dbSelectMock } }));

vi.mock("@/lib/db-helpers", async () => {
  class UnauthorizedError extends Error {
    constructor(msg = "Unauthorized") {
      super(msg);
      this.name = "UnauthorizedError";
    }
  }
  return {
    requireOrgId: vi.fn().mockResolvedValue("firm_test"),
    UnauthorizedError,
  };
});

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn().mockImplementation((err: unknown) => {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.message === "Unauthorized")) {
      return { status: 401, body: { error: "Unauthorized" } };
    }
    if (err instanceof Error && err.name === "ForbiddenError") {
      return { status: 403, body: { error: err.message } };
    }
    return null;
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkExportPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));

const requireClientAccessMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clients/authz", () => ({
  requireClientAccess: requireClientAccessMock,
}));

vi.mock("@/lib/tax-returns/store", () => ({
  getTaxReturn: vi.fn().mockResolvedValue({ status: "ready" }),
}));

vi.mock("@/lib/tax-returns/db", () => ({
  parseRowFacts: vi.fn().mockReturnValue({ facts: { taxYear: 2025 } }),
}));

vi.mock("@/lib/tax-returns/assemble-analysis", () => ({
  buildAnalysisForFacts: vi.fn().mockResolvedValue({ summary: "analysis" }),
  parseYear: vi.fn((raw: string) => {
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }),
}));

const brandingMocks = vi.hoisted(() => ({ resolveBrandingForClient: vi.fn() }));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: brandingMocks.resolveBrandingForClient,
}));

const savePlanToVaultMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: savePlanToVaultMock }));

const recordCompletedRunMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/generation-runs", () => ({ recordCompletedRun: recordCompletedRunMock }));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mocked wholesale (not just renderToBuffer): the real component calls
// StyleSheet.create(...) at module scope, which would throw against a
// @react-pdf/renderer mock that only provides renderToBuffer.
vi.mock("@/components/tax-analysis-pdf/tax-analysis-pdf-document", () => ({
  TaxAnalysisPdfDocument: () => null,
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: renderToBufferMock,
}));

import { POST } from "../route";
import { NextRequest } from "next/server";

const makeReq = () =>
  new NextRequest("http://localhost/api/clients/c1/tax-returns/2025/export-pdf", { method: "POST" });

const params = (taxYear = "2025") => Promise.resolve({ id: "c1", taxYear });

describe("POST /api/clients/[id]/tax-returns/[taxYear]/export-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    savePlanToVaultMock.mockResolvedValue({ id: "doc-1" });
    // The household's primary-contact lookup (only runs when the client has a CRM household).
    dbSelectMock.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ firstName: "Sam", lastName: "Cooper" }]) }),
    });
    recordCompletedRunMock.mockResolvedValue("run-id");
    requireClientAccessMock.mockResolvedValue({
      client: { id: "c1", crmHouseholdId: null, advisorId: "adv-99" },
      firmId: "firm_test",
      permission: "edit",
    });
  });

  it("resolves branding via the client's advisor, not the firm alone", async () => {
    brandingMocks.resolveBrandingForClient.mockResolvedValue({
      firmName: "Advisor Brand",
      primaryColor: "#111111",
      logoDataUrl: "data:image/png;base64,ADV",
    });

    const res = await POST(makeReq(), { params: params() });

    expect(res.status).toBe(200);
    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith("firm_test", "adv-99");

    const doc = renderToBufferMock.mock.calls[0][0];
    expect(doc.props.firmName).toBe("Advisor Brand");
    expect(doc.props.logoDataUrl).toBe("data:image/png;base64,ADV");
  });

  it("forwards the client's own advisorId (route performs no lookup — the client row already carries it)", async () => {
    requireClientAccessMock.mockResolvedValue({
      client: { id: "c1", crmHouseholdId: null, advisorId: "adv-other" },
      firmId: "firm_test",
    });
    brandingMocks.resolveBrandingForClient.mockResolvedValue({
      firmName: "Other Advisor Brand",
      primaryColor: "#333333",
      logoDataUrl: null,
    });

    await POST(makeReq(), { params: params() });

    expect(brandingMocks.resolveBrandingForClient).toHaveBeenCalledWith("firm_test", "adv-other");
  });

  it("files the PDF and logs the run for an edit-level caller", async () => {
    requireClientAccessMock.mockResolvedValue({
      client: { id: "c1", crmHouseholdId: "hh-1", advisorId: "adv-99" },
      firmId: "firm_test",
      permission: "edit",
    });

    await POST(makeReq(), { params: params() });

    expect(savePlanToVaultMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", reportType: "tax_analysis" }),
    );
    expect(recordCompletedRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tax_analysis", resultDocumentId: "doc-1" }),
    );
  });

  it("gives a view-only caller the PDF without filing it or logging a run", async () => {
    requireClientAccessMock.mockResolvedValue({
      client: { id: "c1", crmHouseholdId: "hh-1", advisorId: "adv-99" },
      firmId: "firm_test",
      permission: "view",
      access: "shared",
    });

    const res = await POST(makeReq(), { params: params() });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(savePlanToVaultMock).not.toHaveBeenCalled();
    expect(recordCompletedRunMock).not.toHaveBeenCalled();
  });
});
