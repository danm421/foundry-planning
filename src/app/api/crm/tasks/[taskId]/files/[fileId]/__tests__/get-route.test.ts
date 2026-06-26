import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Vitest 4 removed the implicit hoisting of `mock*`-prefixed consts into
// vi.mock factories, so declare them via vi.hoisted() (repo-standard pattern,
// see src/lib/billing/__tests__/purge-firm.test.ts).
const { mockRequireCrmTaskAccess, mockGetRow, mockDeleteFile, mockGet, mockRecordAudit } =
  vi.hoisted(() => ({
    mockRequireCrmTaskAccess: vi.fn(),
    mockGetRow: vi.fn(),
    mockDeleteFile: vi.fn(),
    mockGet: vi.fn(),
    mockRecordAudit: vi.fn(),
  }));
vi.mock("@/lib/crm/authz", () => ({ requireCrmTaskAccess: mockRequireCrmTaskAccess }));

vi.mock("@/lib/crm-tasks/files", () => ({
  getCrmTaskFileRow: mockGetRow,
  deleteCrmTaskFile: mockDeleteFile,
}));

vi.mock("@vercel/blob", () => ({ get: mockGet }));

vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u" }) }));

import { GET } from "../route";

const ctx = (taskId: string, fileId: string) => ({ params: Promise.resolve({ taskId, fileId }) });
function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCrmTaskAccess.mockResolvedValue({ task: { id: "t1" }, orgId: "firm1" });
});

describe("GET task file", () => {
  it("streams with attachment + nosniff headers and records an audit", async () => {
    mockGetRow.mockResolvedValue({ id: "f1", taskId: "t1", filename: "stmt.pdf", storageKey: "crm-tasks/firm1/t1/x-stmt.pdf", mimeType: "application/pdf" });
    mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("%PDF-"), blob: { contentType: "application/pdf" } });

    const res = await GET(new NextRequest("http://x/api"), ctx("t1", "f1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="stmt.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockGet).toHaveBeenCalledWith("crm-tasks/firm1/t1/x-stmt.pdf", { access: "private" });
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "crm.task.file_downloaded", resourceId: "t1", firmId: "firm1" }));
  });

  it("404s when the row is missing", async () => {
    mockGetRow.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://x/api"), ctx("t1", "missing"));
    expect(res.status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("410s a legacy public-URL row", async () => {
    mockGetRow.mockResolvedValue({ id: "f1", taskId: "t1", filename: "old.pdf", storageKey: "https://old.public.blob/x", mimeType: null });
    const res = await GET(new NextRequest("http://x/api"), ctx("t1", "f1"));
    expect(res.status).toBe(410);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("maps an access error to 404 (no existence leak)", async () => {
    mockRequireCrmTaskAccess.mockRejectedValue(new Error("CRM task not found or access denied: t1"));
    const res = await GET(new NextRequest("http://x/api"), ctx("t1", "f1"));
    expect(res.status).toBe(404);
  });
});
