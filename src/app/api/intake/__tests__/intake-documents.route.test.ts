import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted is required here (not plain top-level consts) because vi.mock
// factories run before the rest of this file's body — ESM import evaluation
// happens before local `const` initializers, so a bare `const loadFormByToken
// = vi.fn()` referenced via the `{ loadFormByToken }` shorthand below would
// throw "Cannot access before initialization".
const {
  loadFormByToken,
  isGateVerified,
  uploadIntakeDocument,
  listIntakeDocuments,
  deleteIntakeDocument,
  checkIntakeDocumentRateLimit,
} = vi.hoisted(() => ({
  loadFormByToken: vi.fn(),
  isGateVerified: vi.fn(),
  uploadIntakeDocument: vi.fn(),
  listIntakeDocuments: vi.fn(),
  deleteIntakeDocument: vi.fn(),
  checkIntakeDocumentRateLimit: vi.fn(),
}));

vi.mock("@/lib/intake/queries", () => ({ loadFormByToken }));
vi.mock("@/lib/intake/gate-session", () => ({ isGateVerified }));
vi.mock("@/lib/intake/documents", () => ({
  uploadIntakeDocument,
  listIntakeDocuments,
  deleteIntakeDocument,
  // The route imports this as a real value (not just the IntakeDocType type),
  // so the mock has to provide it too — kept in sync with the real array in
  // src/lib/intake/documents.ts by inspection; it's a stable, near-frozen list.
  INTAKE_DOC_TYPES: ["statement", "paystub", "mortgage", "tax_return", "estate", "insurance", "other"],
}));
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "1.2.3.4",
  checkIntakeDocumentRateLimit,
  rateLimitErrorResponse: () => new Response("rate limited", { status: 429 }),
}));

import { POST, GET } from "../[token]/documents/route";
import { DELETE } from "../[token]/documents/[docId]/route";

const DRAFT_FORM = {
  id: "form-1",
  status: "draft",
  expiresAt: new Date(Date.now() + 86_400_000),
};

// The exact IntakeDocumentView the mocks resolve to by default — reused (not
// re-typed inline) so the exact-shape assertions below are honest: they prove
// the route's response is exactly this object, not a paraphrase of it.
const DOC_VIEW = {
  id: "d1",
  filename: "s.pdf",
  docType: "statement",
  sizeBytes: 10,
  uploadedAt: "2026-08-06T00:00:00.000Z",
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
  uploadIntakeDocument.mockResolvedValue(DOC_VIEW);
  listIntakeDocuments.mockResolvedValue([]);
  deleteIntakeDocument.mockResolvedValue(true);
  checkIntakeDocumentRateLimit.mockResolvedValue({ allowed: true });
});

describe("rate limiting", () => {
  it("keys the limiter check on token:ip", async () => {
    await POST(uploadRequest(), params);
    expect(checkIntakeDocumentRateLimit).toHaveBeenCalledWith("tok:1.2.3.4");
  });

  it("short-circuits before loadFormByToken and uploadIntakeDocument when the limiter denies", async () => {
    checkIntakeDocumentRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(429);
    expect(loadFormByToken).not.toHaveBeenCalled();
    expect(uploadIntakeDocument).not.toHaveBeenCalled();
  });
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

  it("uploads and returns exactly what uploadIntakeDocument resolved, with no keys added by the route", async () => {
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(201);
    // toEqual (not toMatchObject) so an extra leaked field fails this test —
    // toMatchObject is subset-matching and would pass silently on a leak.
    await expect(res.json()).resolves.toEqual({ document: DOC_VIEW });
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

  // This proves the route layer is an honest pass-through — it adds nothing
  // to (and drops nothing from) what listIntakeDocuments resolves. It is
  // deliberately NOT a test that the route "strips" a storage location: the
  // route never sees one to strip. That guarantee belongs to toView() in
  // src/lib/intake/documents.ts, already covered by Task 4's exact key-set
  // assertion in documents-crud.test.ts. Asserting it again here, against a
  // mock we control, would test our own fixture rather than real behavior.
  it("returns exactly what listIntakeDocuments provides, with no keys added by the route", async () => {
    listIntakeDocuments.mockResolvedValue([DOC_VIEW]);
    const res = await GET(new Request("http://localhost/api/intake/tok/documents"), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ documents: [DOC_VIEW] });
  });
});

const delParams = { params: Promise.resolve({ token: "tok", docId: "d1" }) };

// No test below reads the body, so one Request per test is unnecessary —
// unlike uploadRequest() above, this one never varies.
function deleteRequest(): Request {
  return new Request("http://localhost/x", { method: "DELETE" });
}

describe("DELETE /api/intake/[token]/documents/[docId]", () => {
  it("401s when the identity gate is unverified", async () => {
    isGateVerified.mockResolvedValue(false);
    expect((await DELETE(deleteRequest(), delParams)).status).toBe(401);
    expect(deleteIntakeDocument).not.toHaveBeenCalled();
  });

  it("409s once the form has been submitted", async () => {
    loadFormByToken.mockResolvedValue({ ...DRAFT_FORM, status: "submitted" });
    expect((await DELETE(deleteRequest(), delParams)).status).toBe(409);
  });

  it("404s when the document isn't the client's to delete", async () => {
    deleteIntakeDocument.mockResolvedValue(false);
    expect((await DELETE(deleteRequest(), delParams)).status).toBe(404);
  });

  it("204s on success", async () => {
    deleteIntakeDocument.mockResolvedValue(true);
    expect((await DELETE(deleteRequest(), delParams)).status).toBe(204);
  });
});
