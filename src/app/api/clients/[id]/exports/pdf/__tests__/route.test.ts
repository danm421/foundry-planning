import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@/lib/db-helpers", async () => {
  class UnauthorizedError extends Error {
    constructor(msg = "Unauthorized") {
      super(msg);
      this.name = "UnauthorizedError";
    }
  }
  return {
    requireOrgId: vi.fn().mockResolvedValue("firm_test"),
    UnauthorizedError,
  };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ displayName: "Test Firm" }]),
      }),
    }),
  },
}));

vi.mock("@/components/reports-pdf/artifact-document", () => ({
  ArtifactDocument: ({ children }: { children: unknown }) => children,
}));

vi.mock("@react-pdf/renderer", () => ({
  renderToStream: vi.fn().mockResolvedValue("PDFSTREAM"),
}));

const fetchDataMock = vi.fn();
const renderPdfMock = vi.fn<(input: { charts: unknown[] }) => null>(() => null);
const toCsvSingleMock = vi.fn(() => [{ name: "single.csv", contents: "a,b\r\n1,2\r\n" }]);
const toCsvMultiMock = vi.fn(() => [
  { name: "one.csv", contents: "a\r\n" },
  { name: "two.csv", contents: "b\r\n" },
]);

const baseArtifact = {
  id: "investments",
  title: "Investments",
  section: "assets" as const,
  route: "/clients/[id]/assets/investments",
  variants: ["chart", "data", "chart+data", "csv"] as const,
  optionsSchema: z.object({ drillDownClasses: z.array(z.string()).default([]) }),
  defaultOptions: { drillDownClasses: [] },
  fetchData: fetchDataMock,
  renderPdf: renderPdfMock,
  toCsv: toCsvSingleMock,
};

vi.mock("@/lib/report-artifacts/index", () => ({
  getArtifact: (id: string) => (id === "investments" ? baseArtifact : undefined),
  listArtifacts: () => [],
}));

import { POST } from "../route";
import { NextRequest } from "next/server";

const makeReq = (body: unknown) =>
  new NextRequest("http://localhost/api/clients/c1/exports/pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = Promise.resolve({ id: "c1" });

const seedFetchData = (overrides?: Partial<{ data: unknown; dataVersion: string }>) =>
  fetchDataMock.mockResolvedValue({
    data: { clientName: "Smith Family" },
    asOf: new Date("2026-05-08T12:00:00Z"),
    dataVersion: "v1",
    ...overrides,
  });

describe("POST /api/clients/[id]/exports/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedFetchData();
    baseArtifact.toCsv = toCsvSingleMock;
  });

  it("returns 404 for an unknown reportId", async () => {
    const res = await POST(makeReq({ reportId: "missing", variant: "data" }), { params });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body is missing the variant field", async () => {
    const res = await POST(makeReq({ reportId: "investments" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when variant is outside the global enum", async () => {
    const res = await POST(makeReq({ reportId: "investments", variant: "table" }), { params });
    expect(res.status).toBe(400);
  });

  it("returns 200 + text/csv for a valid single-file CSV request", async () => {
    const res = await POST(makeReq({ reportId: "investments", variant: "csv" }), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toContain("single.csv");
    expect(await res.text()).toBe("a,b\r\n1,2\r\n");
  });

  it("returns 200 + application/zip when the artifact emits multiple CSVs", async () => {
    baseArtifact.toCsv = toCsvMultiMock;
    const res = await POST(makeReq({ reportId: "investments", variant: "csv" }), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");
  });

  it("returns 200 + application/pdf for a valid PDF request", async () => {
    const res = await POST(makeReq({ reportId: "investments", variant: "data" }), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderPdfMock).toHaveBeenCalledOnce();
  });

  it("returns 400 for an unsafe chart dataUrl", async () => {
    const res = await POST(
      makeReq({
        reportId: "investments",
        variant: "data",
        charts: [
          { id: "x", dataUrl: "http://evil/x.png", width: 100, height: 100, dataVersion: "v1" },
        ],
      }),
      { params },
    );
    expect(res.status).toBe(400);
  });

  it("silently drops stale chart captures whose dataVersion does not match", async () => {
    seedFetchData({ dataVersion: "v2" });
    const res = await POST(
      makeReq({
        reportId: "investments",
        variant: "chart",
        charts: [
          {
            id: "donut",
            dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            width: 800,
            height: 500,
            dataVersion: "v1",
          },
        ],
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderPdfMock).toHaveBeenCalledOnce();
    const callArgs = renderPdfMock.mock.calls[0][0];
    expect(callArgs.charts).toEqual([]);
  });

  it("returns 401 when requireOrgId throws UnauthorizedError", async () => {
    const { requireOrgId, UnauthorizedError } = await import("@/lib/db-helpers");
    (requireOrgId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new UnauthorizedError());
    const res = await POST(makeReq({ reportId: "investments", variant: "data" }), { params });
    expect(res.status).toBe(401);
  });
});
