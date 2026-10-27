// src/app/api/clients/[id]/imports/[importId]/files/__tests__/upload-route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SAVE_CLOSED_MESSAGE } from "@/lib/fact-finder/api-types";

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: vi.fn().mockResolvedValue("firm1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, access: "own", permission: "edit", firmId: "firm1" }) }));
vi.mock("@/lib/imports/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/imports/authz")>()), requireImportAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
const { mockTake } = vi.hoisted(() => ({ mockTake: vi.fn() }));
vi.mock("@/lib/uploads/staged-upload", async (orig) => ({ ...(await orig<typeof import("@/lib/uploads/staged-upload")>()), takeStagedUpload: mockTake }));
vi.mock("@/lib/imports/blob", () => ({ uploadImportFile: vi.fn().mockResolvedValue({ url: "https://x.private.blob/f", pathname: "imports/imp1/f/stmt.pdf" }) }));

const { mockInsert } = vi.hoisted(() => ({ mockInsert: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    // No file with the same content on this import yet.
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: (row: unknown) => ({ returning: async () => [mockInsert(row)] }) }),
  },
}));

import { POST } from "../route";
import { requireImportAccess } from "@/lib/imports/authz";
import { uploadImportFile } from "@/lib/imports/blob";
import { StagedUploadError } from "@/lib/uploads/staged-upload";

const ctx = { params: Promise.resolve({ id: "c1", importId: "imp1" }) };
const CLOSED = { at: "2026-10-15T12:00:00.000Z", by: "u1", saved: [], leftOut: [] };

const STAGED = "staging/imports/c1/1700000000000-123e4567-e89b-12d3-a456-426614174000-stmt.pdf";

function upload(fields: Record<string, string> = { stagedPathname: STAGED }): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries({ filename: "stmt.pdf", documentType: "account_statement", ...fields })) form.append(k, v);
  return new NextRequest("http://x/api/clients/c1/imports/imp1/files", { method: "POST", body: form });
}

const importWith = (payloadJson: unknown) => ({ id: "imp1", payloadJson }) as Awaited<ReturnType<typeof requireImportAccess>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockImplementation((row: { id: string }) => ({ ...row }));
  mockTake.mockResolvedValue(Buffer.from("%PDF-1.4 statement"));
});

describe("POST /imports/[importId]/files", () => {
  it("refuses a fact finder import saved to the plan — 409 with the gate's reason and the saved fact finder — and uploads nothing", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith({ factFinder: { version: 3, closed: CLOSED } }));
    const res = await POST(upload(), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(SAVE_CLOSED_MESSAGE);
    expect(body.factFinder).toMatchObject({ version: 3, closed: CLOSED });
    expect(uploadImportFile).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still takes a file for a fact finder import that isn't saved, and for any other import", async () => {
    for (const payloadJson of [{ factFinder: { version: 3 } }, null]) {
      vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(payloadJson));
      const res = await POST(upload(), ctx);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ deduped: false, file: { importId: "imp1", originalFilename: "stmt.pdf", documentType: "account_statement" } });
    }
    expect(uploadImportFile).toHaveBeenCalledTimes(2);
  });

  it("still takes a file for a finished statement-chat import (committed, no fact finder)", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce({ ...importWith({ chat: { surface: "chat" } }), status: "committed" });
    const res = await POST(upload(), ctx);
    expect(res.status).toBe(200);
    expect(uploadImportFile).toHaveBeenCalledTimes(1);
  });

  it("registers a staged upload: reads the bytes back from this client's staging prefix and stores them", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(null));
    const res = await POST(upload(), ctx);
    expect(res.status).toBe(200);
    expect(mockTake).toHaveBeenCalledWith("staging/imports/c1/", STAGED);
    expect(uploadImportFile).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ deduped: false, file: { originalFilename: "stmt.pdf", documentType: "account_statement" } });
  });

  it("refuses a pathname outside this client's staging prefix with 404 and stores nothing", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(null));
    mockTake.mockRejectedValueOnce(new StagedUploadError(404, "Upload not found. Please try again."));
    const res = await POST(upload({ stagedPathname: "staging/imports/other-client/1-x-stmt.pdf" }), ctx);
    expect(res.status).toBe(404);
    expect(uploadImportFile).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("a missing stagedPathname is a 400", async () => {
    vi.mocked(requireImportAccess).mockResolvedValueOnce(importWith(null));
    mockTake.mockRejectedValueOnce(new StagedUploadError(400, "file is required"));
    const res = await POST(upload({ stagedPathname: "" }), ctx);
    expect(res.status).toBe(400);
    expect(uploadImportFile).not.toHaveBeenCalled();
  });
});
