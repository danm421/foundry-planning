import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: vi.fn() };
});
// The real error classes must survive the mocks: the route maps them by `instanceof`.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: vi.fn() };
});
vi.mock("@/lib/imports/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/authz")>("@/lib/imports/authz");
  return { ...actual, requireImportAccess: vi.fn() };
});
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn() }));
vi.mock("@/lib/imports/intake-documents", () => ({ attachIntakeUpload: vi.fn() }));

import { POST } from "../route";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError } from "@/lib/authz";
import { requireImportAccess, NotFoundError } from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { attachIntakeUpload } from "@/lib/imports/intake-documents";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ id: "c1", importId: "i1" }) };

function req(body: unknown) {
  return new Request("http://t/api/clients/c1/imports/i1/intake-documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("org_1");
  vi.mocked(requireActiveSubscription).mockResolvedValue(undefined);
  vi.mocked(auth).mockResolvedValue({ userId: "user_1" } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "org_1",
    access: "own",
  } as never);
  vi.mocked(checkImportRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(requireImportAccess).mockResolvedValue({ id: "i1" } as never);
  vi.mocked(attachIntakeUpload).mockResolvedValue({
    ok: true,
    file: { id: "f1" } as never,
    deduped: false,
  });
});

describe("POST /api/clients/[id]/imports/[importId]/intake-documents", () => {
  it("adds the document to the caller's own import and returns the file", async () => {
    const res = await POST(req({ documentId: DOC_ID }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ file: { id: "f1" }, deduped: false });
    expect(requireImportAccess).toHaveBeenCalledWith({
      importId: "i1",
      clientId: "c1",
      firmId: "org_1",
      userId: "user_1",
    });
    expect(attachIntakeUpload).toHaveBeenCalledWith({
      importId: "i1",
      clientId: "c1",
      firmId: "org_1",
      documentId: DOC_ID,
    });
    expect(checkImportRateLimit).toHaveBeenCalledWith("org_1", "upload");
  });

  it("refuses a lapsed subscription with 403, not 500", async () => {
    vi.mocked(requireActiveSubscription).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req({ documentId: DOC_ID }), params);
    expect(res.status).toBe(403);
    expect(attachIntakeUpload).not.toHaveBeenCalled();
  });

  it("refuses view-only access", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "org_1",
      access: "own",
    } as never);
    const res = await POST(req({ documentId: DOC_ID }), params);
    expect(res.status).toBe(403);
    expect(attachIntakeUpload).not.toHaveBeenCalled();
  });

  it("404s an import that isn't the caller's", async () => {
    vi.mocked(requireImportAccess).mockRejectedValueOnce(new NotFoundError("Import not found"));
    const res = await POST(req({ documentId: DOC_ID }), params);
    expect(res.status).toBe(404);
    expect(attachIntakeUpload).not.toHaveBeenCalled();
  });

  it("fails closed when rate limiting is unavailable", async () => {
    vi.mocked(checkImportRateLimit).mockResolvedValueOnce({
      allowed: false,
      reason: "unconfigured",
    } as never);
    const res = await POST(req({ documentId: DOC_ID }), params);
    expect(res.status).toBe(503);
    expect(attachIntakeUpload).not.toHaveBeenCalled();
  });

  it("400s a body without a document id", async () => {
    const res = await POST(req({ documentId: "not-a-uuid" }), params);
    expect(res.status).toBe(400);
    expect(attachIntakeUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["too_large", 413],
    ["unsupported_type", 400],
  ] as const)("maps a %s refusal to %i", async (reason, status) => {
    vi.mocked(attachIntakeUpload).mockResolvedValueOnce({ ok: false, reason });
    const res = await POST(req({ documentId: DOC_ID }), params);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toEqual(expect.any(String));
  });
});
