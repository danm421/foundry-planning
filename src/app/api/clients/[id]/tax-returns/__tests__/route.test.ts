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
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/tax-returns/store", () => ({
  listTaxReturns: vi.fn(),
  getTaxReturn: vi.fn(),
  upsertExtracted: vi.fn(),
}));
vi.mock("@/lib/tax-returns/extract-facts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/extract-facts")>(
    "@/lib/tax-returns/extract-facts",
  );
  return { ...actual, extractTaxReturnFacts: vi.fn() };
});
vi.mock("@/lib/extraction/validate-upload", () => ({ detectUploadKind: vi.fn() }));

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { listTaxReturns, getTaxReturn, upsertExtracted } from "@/lib/tax-returns/store";
import { extractTaxReturnFacts, TaxReturnExtractionError } from "@/lib/tax-returns/extract-facts";
import { detectUploadKind } from "@/lib/extraction/validate-upload";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { GET, POST } from "../route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const params = { params: Promise.resolve({ id: CLIENT_ID }) };

function grantAccess() {
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true, permission: "edit", firmId: "org_1", access: "own",
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
}

function postRequest(fields: Record<string, string | Blob> = {}): NextRequest {
  const form = new FormData();
  form.set("file", new Blob([Buffer.from("%PDF-fake")], { type: "application/pdf" }), "smith-1040.pdf");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest(`http://test/api/clients/${CLIENT_ID}/tax-returns`, {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  grantAccess();
  vi.mocked(detectUploadKind).mockReturnValue("pdf");
});

describe("GET /api/clients/[id]/tax-returns", () => {
  it("404s when the client is not visible", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: false } as never);
    const res = await GET(new NextRequest("http://test"), params);
    expect(res.status).toBe(404);
  });

  it("lists summaries", async () => {
    vi.mocked(listTaxReturns).mockResolvedValue([
      {
        id: "r1", clientId: CLIENT_ID, taxYear: 2025, status: "ready",
        extractedFacts: null, facts: null, warnings: [], vaultDocumentId: null,
        sourceFilename: "a.pdf", promptVersion: "v", model: "full",
        createdAt: new Date(), updatedAt: new Date(),
      } as never,
    ]);
    const res = await GET(new NextRequest("http://test"), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.returns[0].taxYear).toBe(2025);
  });
});

describe("POST /api/clients/[id]/tax-returns", () => {
  it("extracts, saves to vault, and upserts a needs_review row", async () => {
    const facts = { ...emptyTaxReturnFacts(2025), filingStatus: "single" as const };
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts, isAmended: false, warnings: ["w1"], promptVersion: "tax_return_facts:2026-07-10.1",
    });
    vi.mocked(getTaxReturn).mockResolvedValue(null);
    vi.mocked(upsertExtracted).mockResolvedValue({ taxYear: 2025, status: "needs_review", warnings: ["w1"] } as never);
    const res = await POST(postRequest(), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.taxYear).toBe(2025);
    expect(upsertExtracted).toHaveBeenCalledWith(expect.objectContaining({ clientId: CLIENT_ID, taxYear: 2025 }));
  });

  it("409s when the year exists and replace was not confirmed", async () => {
    const facts = emptyTaxReturnFacts(2024);
    vi.mocked(extractTaxReturnFacts).mockResolvedValue({
      facts, isAmended: false, warnings: [], promptVersion: "v",
    });
    vi.mocked(getTaxReturn).mockResolvedValue({ taxYear: 2024 } as never);
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(409);
    expect(upsertExtracted).not.toHaveBeenCalled();
  });

  it("422s with the user message on extraction failure", async () => {
    vi.mocked(extractTaxReturnFacts).mockRejectedValue(
      new TaxReturnExtractionError("amended", "Amended returns aren't supported yet."),
    );
    const res = await POST(postRequest(), params);
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error).toContain("Amended");
  });

  it("403s without the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1", sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(403);
  });

  it("400s for a non-PDF/image upload", async () => {
    vi.mocked(detectUploadKind).mockReturnValue("xlsx");
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(400);
  });

  it("creates an empty-facts row in manual mode without touching the extractor", async () => {
    vi.mocked(getTaxReturn).mockResolvedValue(null);
    vi.mocked(upsertExtracted).mockResolvedValue({ taxYear: 2023, status: "needs_review", warnings: [] } as never);
    const form = new FormData();
    form.set("manualTaxYear", "2023");
    const res = await POST(
      new NextRequest(`http://test/api/clients/${CLIENT_ID}/tax-returns`, { method: "POST", body: form }),
      params,
    );
    expect(res.status).toBe(200);
    expect(extractTaxReturnFacts).not.toHaveBeenCalled();
    expect(upsertExtracted).toHaveBeenCalledWith(expect.objectContaining({ taxYear: 2023, model: "manual" }));
  });

  it("400s in manual mode for a tax year past the upper bound", async () => {
    const form = new FormData();
    form.set("manualTaxYear", "999999");
    const res = await POST(
      new NextRequest(`http://test/api/clients/${CLIENT_ID}/tax-returns`, { method: "POST", body: form }),
      params,
    );
    expect(res.status).toBe(400);
    expect(extractTaxReturnFacts).not.toHaveBeenCalled();
    expect(upsertExtracted).not.toHaveBeenCalled();
  });
});
