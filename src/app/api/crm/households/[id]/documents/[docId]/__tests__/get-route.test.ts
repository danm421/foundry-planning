import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Vitest 4 removed the implicit hoisting of `mock*`-prefixed consts into
// vi.mock factories, so declare them via vi.hoisted() (repo-standard pattern,
// see src/lib/billing/__tests__/purge-firm.test.ts).
const { mockGetCrmDocument, mockResolvePathname, mockGet, mockRequireOrgId, mockRecordAudit } =
  vi.hoisted(() => ({
    mockGetCrmDocument: vi.fn(),
    mockResolvePathname: vi.fn(),
    mockGet: vi.fn(),
    mockRequireOrgId: vi.fn().mockResolvedValue("firm1"),
    mockRecordAudit: vi.fn(),
  }));
vi.mock("@/lib/crm/documents", () => ({
  getCrmDocument: mockGetCrmDocument,
  resolveDocumentBlobPathname: mockResolvePathname,
  deleteCrmDocument: vi.fn(),
  updateCrmDocument: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ get: mockGet }));

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: mockRequireOrgId }));

vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }));

import { GET } from "../route";

const ctx = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });
function streamOf(t: string): ReadableStream<Uint8Array> {
  const b = new TextEncoder().encode(t);
  return new ReadableStream({ start(c) { c.enqueue(b); c.close(); } });
}

beforeEach(() => vi.clearAllMocks());

describe("GET household document", () => {
  it("sets attachment + nosniff and records a download audit", async () => {
    mockGetCrmDocument.mockResolvedValue({ id: "d1", householdId: "h1", filename: "tax.pdf", mimeType: "application/pdf" });
    mockResolvePathname.mockResolvedValue("crm/h1/x-tax.pdf");
    mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("%PDF-"), blob: { contentType: "application/pdf" } });

    const res = await GET(new NextRequest("http://x"), ctx("h1", "d1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="tax.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "vault.document.download", resourceId: "d1", firmId: "firm1" }));
  });
});
