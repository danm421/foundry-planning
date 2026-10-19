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
  takeStagedUpload,
  issueStagedUpload,
  StagedUploadError,
} = vi.hoisted(() => ({
  loadFormByToken: vi.fn(),
  isGateVerified: vi.fn(),
  uploadIntakeDocument: vi.fn(),
  listIntakeDocuments: vi.fn(),
  deleteIntakeDocument: vi.fn(),
  checkIntakeDocumentRateLimit: vi.fn(),
  takeStagedUpload: vi.fn(),
  issueStagedUpload: vi.fn(),
  StagedUploadError: class StagedUploadError extends Error {
    constructor(
      readonly status: 400 | 404,
      message: string,
    ) {
      super(message);
    }
  },
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
// The real module pulls in @/db via @/lib/crm/documents; stagingPrefix is
// restated here so the prefix assertions below pin its real shape.
vi.mock("@/lib/uploads/staged-upload", () => ({
  stagingPrefix: (surface: string, id: string) => `staging/${surface}/${id}/`,
  takeStagedUpload,
  issueStagedUpload,
  StagedUploadError,
}));
vi.mock("@/lib/rate-limit", () => ({
  extractClientIp: () => "1.2.3.4",
  checkIntakeDocumentRateLimit,
  rateLimitErrorResponse: () => new Response("rate limited", { status: 429 }),
}));

import { POST, GET } from "../[token]/documents/route";
import { DELETE } from "../[token]/documents/[docId]/route";
import { POST as POST_TOKEN } from "../[token]/documents/upload-token/route";

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

const STAGED = "staging/intake/form-1/1760000000000-123e4567-e89b-12d3-a456-426614174000-s.pdf";

function uploadRequest(docType = "statement"): Request {
  const fd = new FormData();
  fd.set("stagedPathname", STAGED);
  fd.set("filename", "s.pdf");
  fd.set("contentType", "application/pdf");
  fd.set("docType", docType);
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
  takeStagedUpload.mockResolvedValue(Buffer.from("%PDF-1.4\n"));
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

  it("400s on an unknown docType, still taking (and so deleting) the staged copy", async () => {
    expect((await POST(uploadRequest("not-a-type"), params)).status).toBe(400);
    expect(takeStagedUpload).toHaveBeenCalled();
    expect(uploadIntakeDocument).not.toHaveBeenCalled();
  });

  it("files the staged bytes from this form's own prefix, under the client's name and type", async () => {
    await POST(uploadRequest(), params);
    expect(takeStagedUpload).toHaveBeenCalledWith("staging/intake/form-1/", STAGED);
    const [formId, file, docType] = uploadIntakeDocument.mock.calls[0];
    expect(formId).toBe("form-1");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("s.pdf");
    expect((file as File).type).toBe("application/pdf");
    expect(Buffer.from(await (file as File).arrayBuffer()).toString()).toBe("%PDF-1.4\n");
    expect(docType).toBe("statement");
  });

  it("passes a staged-upload refusal through without filing anything", async () => {
    takeStagedUpload.mockRejectedValue(new StagedUploadError(404, "Upload not found. Please try again."));
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Upload not found. Please try again." });
    expect(uploadIntakeDocument).not.toHaveBeenCalled();
  });

  it("uploads and returns exactly what uploadIntakeDocument resolved, with no keys added by the route", async () => {
    const res = await POST(uploadRequest(), params);
    expect(res.status).toBe(201);
    // toEqual (not toMatchObject) so an extra leaked field fails this test —
    // toMatchObject is subset-matching and would pass silently on a leak.
    await expect(res.json()).resolves.toEqual({ document: DOC_VIEW });
  });

  it("413s when the lib reports the file is too large", async () => {
    uploadIntakeDocument.mockRejectedValue(new Error("File too large. Maximum size is 30MB."));
    expect((await POST(uploadRequest(), params)).status).toBe(413);
  });

  it("400s when the form's file-count or total-size cap is reached", async () => {
    uploadIntakeDocument.mockRejectedValue(new Error("You've attached too many documents. The limit is 25."));
    expect((await POST(uploadRequest(), params)).status).toBe(400);
    uploadIntakeDocument.mockRejectedValue(new Error("These documents exceed the total size limit for one form."));
    expect((await POST(uploadRequest(), params)).status).toBe(400);
  });
});

describe("POST /api/intake/[token]/documents/upload-token", () => {
  function tokenRequest(body: unknown = { filename: "s.pdf" }): Request {
    return new Request("http://localhost/api/intake/tok/documents/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("issues a 30 MB token under this form's own staging prefix", async () => {
    issueStagedUpload.mockResolvedValue({ pathname: STAGED, clientToken: "ct" });
    const res = await POST_TOKEN(tokenRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pathname: STAGED, clientToken: "ct" });
    expect(issueStagedUpload).toHaveBeenCalledWith("staging/intake/form-1/", "s.pdf", 30 * 1024 * 1024);
  });

  it("is behind the same gate as the upload itself", async () => {
    isGateVerified.mockResolvedValue(false);
    expect((await POST_TOKEN(tokenRequest(), params)).status).toBe(401);
    loadFormByToken.mockResolvedValue({ ...DRAFT_FORM, status: "submitted" });
    isGateVerified.mockResolvedValue(true);
    expect((await POST_TOKEN(tokenRequest(), params)).status).toBe(409);
    expect(issueStagedUpload).not.toHaveBeenCalled();
  });

  it("400s without a filename", async () => {
    expect((await POST_TOKEN(tokenRequest({}), params)).status).toBe(400);
    expect(issueStagedUpload).not.toHaveBeenCalled();
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

// A real UUID shape — the [docId] route 404s a malformed id before it ever
// reaches deleteIntakeDocument, so these path-param fixtures must look like
// the real crm_household_documents.id column (uuid) or every test past the
// gate would be exercising that guard by accident instead of what it claims to.
const DOC_ID = "123e4567-e89b-12d3-a456-426614174000";
const delParams = { params: Promise.resolve({ token: "tok", docId: DOC_ID }) };

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

  it("204s on success, deleting exactly the gated form and the requested doc", async () => {
    deleteIntakeDocument.mockResolvedValue(true);
    expect((await DELETE(deleteRequest(), delParams)).status).toBe(204);
    expect(deleteIntakeDocument).toHaveBeenCalledWith("form-1", DOC_ID);
  });

  it("404s on a non-UUID docId without ever calling deleteIntakeDocument", async () => {
    const badParams = { params: Promise.resolve({ token: "tok", docId: "not-a-uuid" }) };
    expect((await DELETE(deleteRequest(), badParams)).status).toBe(404);
    expect(deleteIntakeDocument).not.toHaveBeenCalled();
  });
});
