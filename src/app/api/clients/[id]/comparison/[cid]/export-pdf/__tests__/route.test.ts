import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOrgId: vi.fn(),
  loadExportData: vi.fn(),
  renderToStream: vi.fn(),
}));

vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgId: mocks.requireOrgId };
});
vi.mock("@/lib/comparison-pdf/load-export-data", () => ({
  loadExportData: mocks.loadExportData,
}));
vi.mock("@react-pdf/renderer", async () => {
  const actual = await vi.importActual<typeof import("@react-pdf/renderer")>("@react-pdf/renderer");
  return { ...actual, renderToStream: mocks.renderToStream };
});

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/clients/[id]/comparison/[cid]/export-pdf", () => {
  beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

  it("returns 401 when org context is missing", async () => {
    mocks.requireOrgId.mockRejectedValue(Object.assign(new Error("Unauthorized"), { name: "UnauthorizedError" }));
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ chartImages: {} }), { params: Promise.resolve({ id: "c1", cid: "cmp1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when comparison is missing", async () => {
    mocks.requireOrgId.mockResolvedValue("firm-1");
    mocks.loadExportData.mockResolvedValue(null);
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ chartImages: {} }), { params: Promise.resolve({ id: "c1", cid: "cmp1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 on malformed body", async () => {
    mocks.requireOrgId.mockResolvedValue("firm-1");
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/test", { method: "POST", body: "not-json" }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "c1", cid: "cmp1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects unsafe PNG values in chartImages", async () => {
    mocks.requireOrgId.mockResolvedValue("firm-1");
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({ chartImages: { c1: "https://evil.example/file.png" } }),
      { params: Promise.resolve({ id: "c1", cid: "cmp1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("streams a PDF on the happy path", async () => {
    mocks.requireOrgId.mockResolvedValue("firm-1");
    mocks.loadExportData.mockResolvedValue({
      client: {
        id: "c1", firmId: "firm-1", advisorId: "u1",
        firstName: "John", lastName: "Doe", spouseName: null, spouseLastName: null,
      },
      layout: { version: 5, title: "Report", groups: [] },
      comparisonName: "Report",
      plans: [],
      branding: { primaryColor: "#000", firmName: "Acme", logoDataUrl: null },
      advisorName: "Jane",
      asOf: new Date("2026-05-13T00:00:00Z"),
    });
    mocks.renderToStream.mockResolvedValue(new ReadableStream());
    const { POST } = await import("../route");
    const res = await POST(makeRequest({ chartImages: {} }), { params: Promise.resolve({ id: "c1", cid: "cmp1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/doe.*report.*\.pdf/i);
  });
});
