import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_1") };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, permission: "edit", firmId: "org_1", access: "own" }),
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "org_1", access: { access: "own" } }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/tax-returns/store", () => ({
  getTaxReturn: vi.fn(),
  getPriorTaxReturn: vi.fn().mockResolvedValue(null),
  deleteTaxReturn: vi.fn(),
}));
vi.mock("@/lib/tax-returns/save-facts", () => ({ saveReviewedFacts: vi.fn() }));
vi.mock("@/lib/tax-returns/load-analysis-context", () => ({ loadAnalysisContext: vi.fn() }));
// assembleTaxAnalysis (which GET now goes through) loads the row's supporting
// documents by tax_return id. `store` is mocked above, so that id is the
// fixture's "r1" — a real query with it reaches Neon and dies in string_to_uuid.
// Only the two DB readers are replaced; rowToMergeDocument stays real.
vi.mock("@/lib/tax-returns/documents-store", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tax-returns/documents-store")>(
      "@/lib/tax-returns/documents-store",
    );
  return {
    ...actual,
    listDocuments: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockResolvedValue(null),
  };
});

import { getTaxReturn, deleteTaxReturn } from "@/lib/tax-returns/store";
import { saveReviewedFacts } from "@/lib/tax-returns/save-facts";
import { EmptyRecomputeError } from "@/lib/tax-returns/errors";
import { loadAnalysisContext } from "@/lib/tax-returns/load-analysis-context";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj } from "@/lib/tax-analysis/__tests__/fixtures";
import { GET, PUT, DELETE } from "../route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const routeParams = { params: Promise.resolve({ id: CLIENT_ID, taxYear: "2025" }) };

function makeRow(facts = retireeMfj()) {
  return {
    id: "r1", clientId: CLIENT_ID, taxYear: 2025, status: "needs_review",
    extractedFacts: facts, facts, warnings: [], vaultDocumentId: null,
    sourceFilename: "a.pdf", promptVersion: "v", model: "full",
    createdAt: new Date(), updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAnalysisContext).mockResolvedValue({
    resolver: createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 }),
    primaryAge: 72,
    spouseAge: 72,
  });
});

describe("GET .../tax-returns/[taxYear]", () => {
  it("returns the row with a computed analysis bundle", async () => {
    vi.mocked(getTaxReturn).mockResolvedValue(makeRow() as never);
    const res = await GET(new NextRequest("http://test"), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.analysis.keyFigures.agi).toBe(188700);
    expect(body.analysis.findings.length).toBeGreaterThan(0);
  });

  it("404s for a missing year", async () => {
    vi.mocked(getTaxReturn).mockResolvedValue(null);
    const res = await GET(new NextRequest("http://test"), routeParams);
    expect(res.status).toBe(404);
  });

  it("400s for a non-numeric year", async () => {
    const res = await GET(new NextRequest("http://test"), {
      params: Promise.resolve({ id: CLIENT_ID, taxYear: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT .../tax-returns/[taxYear]", () => {
  it("saves corrected facts and can mark ready", async () => {
    vi.mocked(saveReviewedFacts).mockResolvedValue({ taxYear: 2025, status: "ready" });
    const res = await PUT(
      new NextRequest("http://test", {
        method: "PUT",
        body: JSON.stringify({ facts: emptyTaxReturnFacts(2025), markReady: true }),
        headers: { "content-type": "application/json" },
      }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(saveReviewedFacts).toHaveBeenCalledWith({
      clientId: CLIENT_ID, taxYear: 2025, submitted: expect.anything(), nextStatus: "ready",
    });
  });

  it("reopens a ready return to needs_review", async () => {
    vi.mocked(saveReviewedFacts).mockResolvedValue({ taxYear: 2025, status: "needs_review" });
    const res = await PUT(
      new NextRequest("http://test", {
        method: "PUT",
        body: JSON.stringify({ facts: emptyTaxReturnFacts(2025), reopen: true }),
        headers: { "content-type": "application/json" },
      }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(saveReviewedFacts).toHaveBeenCalledWith({
      clientId: CLIENT_ID, taxYear: 2025, submitted: expect.anything(), nextStatus: "needs_review",
    });
  });

  it("400s on facts that fail the schema", async () => {
    const res = await PUT(
      new NextRequest("http://test", {
        method: "PUT",
        body: JSON.stringify({ facts: { taxYear: 1999 } }),
        headers: { "content-type": "application/json" },
      }),
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it("400s when the facts payload's taxYear doesn't match the URL's taxYear", async () => {
    const res = await PUT(
      new NextRequest("http://test", {
        method: "PUT",
        body: JSON.stringify({ facts: emptyTaxReturnFacts(2024), markReady: false }),
        headers: { "content-type": "application/json" },
      }),
      routeParams, // URL year is 2025
    );
    expect(res.status).toBe(400);
    expect(saveReviewedFacts).not.toHaveBeenCalled();
  });

  it("409s with a clear message rather than blanking a document-less return", async () => {
    vi.mocked(saveReviewedFacts).mockRejectedValue(new EmptyRecomputeError("r1"));
    const res = await PUT(
      new NextRequest("http://test", {
        method: "PUT",
        body: JSON.stringify({ facts: emptyTaxReturnFacts(2025) }),
        headers: { "content-type": "application/json" },
      }),
      routeParams,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("empty_return");
    expect(body.message).toMatch(/document/i);
  });
});

describe("DELETE .../tax-returns/[taxYear]", () => {
  it("deletes and audits", async () => {
    vi.mocked(deleteTaxReturn).mockResolvedValue(true);
    const res = await DELETE(new NextRequest("http://test", { method: "DELETE" }), routeParams);
    expect(res.status).toBe(200);
  });
});
