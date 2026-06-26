import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db-helpers", async (orig) => ({ ...(await orig<typeof import("@/lib/db-helpers")>()), requireOrgId: vi.fn().mockResolvedValue("firm1") }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn().mockResolvedValue({ userId: "u1" }) }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn().mockResolvedValue({ ok: true, access: "own", permission: "edit" }) }));
vi.mock("@/lib/imports/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/imports/authz")>()), requireImportAccess: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ checkImportRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Vitest 4 removed implicit hoisting of `mock*`-prefixed consts into vi.mock
// factories, so declare them via vi.hoisted() (repo-standard pattern, see
// src/app/api/crm/tasks/[taskId]/files/[fileId]/__tests__/get-route.test.ts).
const { mockGet, mockSelect } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSelect: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: mockGet }));

vi.mock("@/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mockSelect() }) }) }) } }));

import { GET } from "../route";

const ctx = (id: string, importId: string, fileId: string) => ({ params: Promise.resolve({ id, importId, fileId }) });
function streamOf(t: string): ReadableStream<Uint8Array> {
  const b = new TextEncoder().encode(t);
  return new ReadableStream({ start(c) { c.enqueue(b); c.close(); } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockResolvedValue([{ id: "f1", importId: "imp1", blobUrl: "https://x.private.blob/imports/imp1/f1/stmt.pdf", blobPathname: "imports/imp1/f1/stmt.pdf", originalFilename: "stmt.pdf", deletedAt: null }]);
});

it("uses get(blobPathname) and serves attachment + nosniff", async () => {
  mockGet.mockResolvedValue({ statusCode: 200, stream: streamOf("%PDF-"), blob: { contentType: "application/pdf" } });

  const res = await GET(new NextRequest("http://x"), ctx("c1", "imp1", "f1"));

  expect(res.status).toBe(200);
  expect(mockGet).toHaveBeenCalledWith("imports/imp1/f1/stmt.pdf", { access: "private" });
  expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="stmt.pdf"');
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
