import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted is required here (not plain top-level consts) because vi.mock
// factories run before the rest of this file's body — ESM import evaluation
// happens before local `const` initializers, so a bare `const loadFormByToken
// = vi.fn()` referenced via the `{ loadFormByToken }` shorthand below would
// throw "Cannot access before initialization".
const { loadFormByToken, isGateVerified, uploadIntakeDocument, listIntakeDocuments } = vi.hoisted(
  () => ({
    loadFormByToken: vi.fn(),
    isGateVerified: vi.fn(),
    uploadIntakeDocument: vi.fn(),
    listIntakeDocuments: vi.fn(),
  }),
);

vi.mock("@/lib/intake/queries", () => ({ loadFormByToken }));
vi.mock("@/lib/intake/gate-session", () => ({ isGateVerified }));
vi.mock("@/lib/intake/documents", () => ({ uploadIntakeDocument, listIntakeDocuments }));
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "1.2.3.4",
  checkIntakeDocumentRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitErrorResponse: () => new Response("rate limited", { status: 429 }),
}));

import { POST, GET } from "../[token]/documents/route";

const DRAFT_FORM = {
  id: "form-1",
  status: "draft",
  expiresAt: new Date(Date.now() + 86_400_000),
};

function uploadRequest(): Request {
  const fd = new FormData();
  fd.set("file", new File([Buffer.from("%PDF-1.4\n")], "s.pdf", { type: "application/pdf" }));
  fd.set("docType", "statement");
  return new Request("http://localhost/api/intake/tok/documents", { method: "POST", body: fd });
}

const params = { params: Promise.resolve({ token: "tok" }) };

beforeEach(() => {
  vi.clearAllMocks();
  loadFormByToken.mockResolvedValue(DRAFT_FORM);
  isGateVerified.mockResolvedValue(true);
  uploadIntakeDocument.mockResolvedValue({
    id: "d1", filename: "s.pdf", docType: "statement", sizeBytes: 10, uploadedAt: "2026-08-06T00:00:00.000Z",
  });
  listIntakeDocuments.mockResolvedValue([]);
});

describe("POST /api/intake/[token]/documents", () => {
  it("401s when the identity gate is unverified", async () => {
    isGateVerified.mockResolvedValue(false);
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(401);
    expect(uploadIntakeDocument).not.toHaveBeenCalled();
  });

  it("404s on an unknown token", async () => {
    loadFormByToken.mockResolvedValue(null);
    expect((await POST(uploadRequest(), params)).status).toBe(404);
  });

  it("410s on an expired form", async () => {
    loadFormByToken.mockResolvedValue({ ...DRAFT_FORM, expiresAt: new Date(Date.now() - 1000) });
    expect((await POST(uploadRequest(), params)).status).toBe(410);
  });

  it("409s once the form has been submitted", async () => {
    loadFormByToken.mockResolvedValue({ ...DRAFT_FORM, status: "submitted" });
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(409);
    expect(uploadIntakeDocument).not.toHaveBeenCalled();
  });

  it("400s on an unknown docType", async () => {
    const fd = new FormData();
    fd.set("file", new File([Buffer.from("%PDF-1.4\n")], "s.pdf", { type: "application/pdf" }));
    fd.set("docType", "not-a-type");
    const req = new Request("http://localhost/api/intake/tok/documents", { method: "POST", body: fd });
    expect((await POST(req, params)).status).toBe(400);
  });

  it("uploads and returns the view on the happy path", async () => {
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ document: { filename: "s.pdf" } });
  });

  it("413s when the lib reports the file is too large", async () => {
    uploadIntakeDocument.mockRejectedValue(new Error("File too large. Maximum size is 10MB."));
    expect((await POST(uploadRequest(), params)).status).toBe(413);
  });

  it("400s when content validation rejects the bytes", async () => {
    uploadIntakeDocument.mockRejectedValue(new Error("Unsupported or unsafe file type. Allowed: …"));
    expect((await POST(uploadRequest(), params)).status).toBe(400);
  });
});

describe("GET /api/intake/[token]/documents", () => {
  it("401s when the identity gate is unverified", async () => {
    isGateVerified.mockResolvedValue(false);
    const req = new Request("http://localhost/api/intake/tok/documents");
    expect((await GET(req, params)).status).toBe(401);
  });

  it("returns the document list without any storage location", async () => {
    listIntakeDocuments.mockResolvedValue([
      { id: "d1", filename: "s.pdf", docType: "statement", sizeBytes: 10, uploadedAt: "2026-08-06T00:00:00.000Z" },
    ]);
    const res = await GET(new Request("http://localhost/api/intake/tok/documents"), params);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain("storageKey");
    expect(body).not.toContain("blob.vercel-storage.com");
  });
});
