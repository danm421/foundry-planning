import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    requireActiveSubscription: vi.fn().mockResolvedValue(undefined),
    // DELETE mirrors the sibling [taxYear] route's posture, which gates on
    // the firm-keyed variant rather than the session-only one POST uses.
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(),
  // DELETE mirrors the sibling [taxYear] route's posture (requireClientEditAccess),
  // not POST's verifyClientAccess check.
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/extraction/validate-upload", () => ({ detectUploadKind: vi.fn(() => "pdf") }));
vi.mock("@/lib/tax-returns/store", () => ({ getTaxReturn: vi.fn() }));
vi.mock("@/lib/tax-returns/add-document", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/add-document")>(
    "@/lib/tax-returns/add-document",
  );
  return { ...actual, addDocumentToReturn: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { addDocumentToReturn, TaxYearMismatchError } from "@/lib/tax-returns/add-document";
import { POST } from "../route";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const RETURN_ID = "33333333-3333-3333-3333-333333333333";
const params = { params: Promise.resolve({ id: CLIENT_ID, taxYear: "2024" }) };

function grantAccess() {
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(auth).mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_import"] } },
  } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true, permission: "edit", firmId: "org_1", access: "own",
  } as never);
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    firmId: "org_1", access: "own",
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(getTaxReturn).mockResolvedValue({ id: RETURN_ID, taxYear: 2024 } as never);
}

function postRequest(fields: Record<string, string | Blob> = {}): NextRequest {
  const form = new FormData();
  form.set("file", new Blob([Buffer.from("%PDF-")], { type: "application/pdf" }), "k1.pdf");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new NextRequest("http://localhost/api/x", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  grantAccess();
});

describe("POST /tax-returns/[taxYear]/documents", () => {
  it("adds the document and returns its id and role", async () => {
    vi.mocked(addDocumentToReturn).mockResolvedValue({
      documentId: "doc-9", role: "k1", warnings: [],
    });
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ documentId: "doc-9", role: "k1" });
  });

  it("passes the advisor's explicit role straight through", async () => {
    vi.mocked(addDocumentToReturn).mockResolvedValue({
      documentId: "doc-9", role: "w2", warnings: [],
    });
    await POST(postRequest({ role: "w2" }), params);
    expect(vi.mocked(addDocumentToReturn).mock.calls[0][0].role).toBe("w2");
  });

  it("defaults to auto-detect when no role is given", async () => {
    vi.mocked(addDocumentToReturn).mockResolvedValue({
      documentId: "doc-9", role: "k1", warnings: [],
    });
    await POST(postRequest(), params);
    expect(vi.mocked(addDocumentToReturn).mock.calls[0][0].role).toBe("auto");
  });

  it("rejects a role the enum does not contain, rather than passing it down", async () => {
    const res = await POST(postRequest({ role: "1099" }), params);
    expect(res.status).toBe(400);
    expect(addDocumentToReturn).not.toHaveBeenCalled();
  });

  it("returns 409 year_mismatch with both years in the message", async () => {
    vi.mocked(addDocumentToReturn).mockRejectedValue(new TaxYearMismatchError(2023, 2024));
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("year_mismatch");
    expect(body.message).toContain("2023");
    expect(body.message).toContain("2024");
  });

  it("404s when the year does not exist", async () => {
    vi.mocked(getTaxReturn).mockResolvedValue(null);
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(404);
  });

  it("403s without the ai_import entitlement", async () => {
    vi.mocked(auth).mockResolvedValue({
      userId: "user_1", sessionClaims: { org_public_metadata: { entitlements: [] } },
    } as never);
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(403);
  });

  it("403s on read-only access", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValue({
      ok: true, permission: "view", firmId: "org_1", access: "own",
    } as never);
    const res = await POST(postRequest(), params);
    expect(res.status).toBe(403);
  });
});

vi.mock("@/lib/tax-returns/documents-store", () => ({ deleteDocument: vi.fn() }));
vi.mock("@/lib/tax-returns/recompute", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tax-returns/recompute")>(
    "@/lib/tax-returns/recompute",
  );
  return { ...actual, recomputeFacts: vi.fn() };
});

import { deleteDocument } from "@/lib/tax-returns/documents-store";
import { recomputeFacts } from "@/lib/tax-returns/recompute";
import { EmptyRecomputeError } from "@/lib/tax-returns/errors";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { DELETE } from "../[documentId]/route";

const DOC_ID = "44444444-4444-4444-4444-444444444444";
const deleteParams = {
  params: Promise.resolve({ id: CLIENT_ID, taxYear: "2024", documentId: DOC_ID }),
};
const deleteRequest = () => new NextRequest("http://localhost/api/x", { method: "DELETE" });

describe("DELETE /tax-returns/[taxYear]/documents/[documentId]", () => {
  it("removes the document and recomputes", async () => {
    vi.mocked(deleteDocument).mockResolvedValue({ id: DOC_ID } as never);
    vi.mocked(recomputeFacts).mockResolvedValue(emptyTaxReturnFacts(2024));

    const res = await DELETE(deleteRequest(), deleteParams);

    expect(res.status).toBe(200);
    expect(deleteDocument).toHaveBeenCalledWith(RETURN_ID, DOC_ID);
    expect(recomputeFacts).toHaveBeenCalledWith(RETURN_ID, 2024);
  });

  it("404s when the document is not on this return", async () => {
    vi.mocked(deleteDocument).mockResolvedValue(null);
    const res = await DELETE(deleteRequest(), deleteParams);
    expect(res.status).toBe(404);
    expect(recomputeFacts).not.toHaveBeenCalled();
  });

  it("409s rather than blanking the year when the last document is removed", async () => {
    vi.mocked(deleteDocument).mockResolvedValue({ id: DOC_ID } as never);
    vi.mocked(recomputeFacts).mockRejectedValue(new EmptyRecomputeError(RETURN_ID));

    const res = await DELETE(deleteRequest(), deleteParams);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "last_document" });
  });
});
