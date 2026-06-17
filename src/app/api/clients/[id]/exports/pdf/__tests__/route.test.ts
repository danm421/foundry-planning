import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test", orgId: "firm_test" }),
  currentUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "advisor@firm.com" }] }),
}));

vi.mock("@/lib/crm/generation-runs", () => ({
  recordCompletedRun: vi.fn().mockResolvedValue("run-id"),
}));

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

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn().mockImplementation((err: unknown) => {
    if (err instanceof Error && (err.name === "UnauthorizedError" || err.message === "Unauthorized")) {
      return { status: 401, body: { error: "Unauthorized" } };
    }
    if (err instanceof Error && err.name === "ForbiddenError") {
      return { status: 403, body: { error: err.message } };
    }
    return null;
  }),
}));

// The route gained a PDF-export rate-limit guard (audit F11); let it pass so
// tests don't hit the real shared Upstash budget (nondeterministic once spent).
vi.mock("@/lib/rate-limit", () => ({
  checkExportPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ displayName: "Test Firm", householdId: "hh-test" }]),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ displayName: "Test Firm", householdId: "hh-test" }]).then(resolve),
        }),
      }),
    }),
  },
}));

// Phase-1b advisor gate. Returns a client carrying crmHouseholdId so the
// run-log capture branch runs (the route reads it off the gated row now,
// not via a second @/db query).
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockImplementation(async (clientId: string) => {
    return { client: { id: clientId, crmHouseholdId: "hh-test" }, firmId: "firm_test", access: "own" };
  }),
}));

vi.mock("@/components/pdf/artifact-document", () => ({
  ArtifactDocument: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/lib/crm/vault-plans", () => ({
  savePlanToVault: vi.fn().mockResolvedValue(null),
}));

vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7 test")),
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

const cashflowFetchDataMock = vi.fn();
const cashflowRenderPdfMock = vi.fn<(input: { charts: unknown[] }) => null>(() => null);
const cashflowToCsvMultiMock = vi.fn(() => [
  { name: "cashflow-base.csv", contents: "Year,Age(s),Income\r\n2026,60 / 58,200000\r\n" },
  { name: "cashflow-income.csv", contents: "Year,Age(s),Salaries\r\n2026,60 / 58,200000\r\n" },
  { name: "cashflow-expenses.csv", contents: "Year,Age(s),Living\r\n2026,60 / 58,80000\r\n" },
  { name: "cashflow-withdrawals.csv", contents: "Year,Age(s),Growth\r\n2026,60 / 58,40000\r\n" },
  { name: "cashflow-assets.csv", contents: "Year,Age(s),Total\r\n2026,60 / 58,500000\r\n" },
]);

const cashflowArtifactStub = {
  id: "cashflow",
  title: "Cash Flow",
  section: "cashflow" as const,
  route: "/clients/[id]/cashflow",
  variants: ["chart", "data", "chart+data", "csv"] as const,
  optionsSchema: z.object({
    scenarioId: z.string().nullable().default(null),
    yearStart: z.number().int().nullable().default(null),
    yearEnd: z.number().int().nullable().default(null),
  }),
  defaultOptions: { scenarioId: null, yearStart: null, yearEnd: null },
  fetchData: cashflowFetchDataMock,
  renderPdf: cashflowRenderPdfMock,
  toCsv: cashflowToCsvMultiMock,
};

vi.mock("@/lib/report-artifacts/index", () => ({
  getArtifact: (id: string) => {
    if (id === "investments") return baseArtifact;
    if (id === "cashflow") return cashflowArtifactStub;
    return undefined;
  },
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

  it("captures the PDF export to the vault as reportType 'report:<id>'", async () => {
    const { savePlanToVault } = await import("@/lib/crm/vault-plans");
    const res = await POST(makeReq({ reportId: "investments", variant: "data" }), { params });
    expect(res.status).toBe(200);
    expect(savePlanToVault).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        firmId: "firm_test",
        reportType: "report:investments",
        scenarioId: null,
      }),
    );
    const { recordCompletedRun } = await import("@/lib/crm/generation-runs");
    expect(recordCompletedRun).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "report:investments", resultDocumentId: null }),
    );
  });

  it("does NOT capture CSV exports to the vault", async () => {
    const { savePlanToVault } = await import("@/lib/crm/vault-plans");
    await POST(makeReq({ reportId: "investments", variant: "csv" }), { params });
    expect(savePlanToVault).not.toHaveBeenCalled();
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

  it("forwards client-supplied chart captures to renderPdf without a drift gate (v1)", async () => {
    seedFetchData({ dataVersion: "v2" });
    const chart = {
      id: "donut",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: 800,
      height: 500,
      dataVersion: "v1",
    };
    const res = await POST(
      makeReq({ reportId: "investments", variant: "chart", charts: [chart] }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(renderPdfMock).toHaveBeenCalledOnce();
    const callArgs = renderPdfMock.mock.calls[0][0];
    expect(callArgs.charts).toEqual([chart]);
  });

  it("returns 401 when requireClientEditAccess throws UnauthorizedError", async () => {
    const { requireClientEditAccess } = await import("@/lib/clients/authz");
    const { UnauthorizedError } = await import("@/lib/db-helpers");
    (requireClientEditAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new UnauthorizedError());
    const res = await POST(makeReq({ reportId: "investments", variant: "data" }), { params });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/clients/[id]/exports/pdf — cashflow", () => {
  const seedCashflowFetchData = () =>
    cashflowFetchDataMock.mockResolvedValue({
      data: {
        clientName: "Jane Doe",
        scenarioLabel: "Base Case",
        yearRange: [2026, 2026],
        sections: {
          base: { id: "base", title: "Cash Flow — Summary", headers: [], rows: [{ year: 2026, age: "60 / 58", cells: { totalIncome: 200_000, totalExpenses: 134_000, netCashFlow: 66_000, portfolioTotal: 500_000 } }], totals: {} },
          income: { id: "income", title: "Income Detail", headers: [], rows: [{ year: 2026, age: "60 / 58", cells: { salaries: 200_000, total: 200_000 } }], totals: {} },
          expenses: { id: "expenses", title: "Expenses Detail", headers: [], rows: [{ year: 2026, age: "60 / 58", cells: { living: 80_000, total: 134_000 } }], totals: {} },
          withdrawals: { id: "withdrawals", title: "Net Cash Flow Detail", headers: [], rows: [{ year: 2026, age: "60 / 58", cells: { growth: 40_000, netCashFlow: 66_000 } }], totals: {} },
          assets: { id: "assets", title: "Portfolio Detail", headers: [], rows: [{ year: 2026, age: "60 / 58", cells: { taxable: 500_000, total: 500_000 } }], totals: {} },
        },
      },
      asOf: new Date("2026-05-09T12:00:00Z"),
      dataVersion: "abc123",
    });

  beforeEach(() => {
    vi.clearAllMocks();
    seedCashflowFetchData();
  });

  it("variant=data returns 200 + application/pdf", async () => {
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "data", opts: { scenarioId: null, yearStart: 2026, yearEnd: 2030 } }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(cashflowRenderPdfMock).toHaveBeenCalledOnce();
  });

  it("variant=chart+data with empty charts returns 200 + application/pdf", async () => {
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "chart+data", opts: { scenarioId: null, yearStart: 2026, yearEnd: 2030 }, charts: [] }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(cashflowRenderPdfMock).toHaveBeenCalledOnce();
  });

  it("variant=chart with one cached chart returns 200 + application/pdf", async () => {
    const chart = {
      id: "income",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      width: 800,
      height: 500,
      dataVersion: "abc123",
    };
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "chart", charts: [chart] }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(cashflowRenderPdfMock).toHaveBeenCalledOnce();
    const callArgs = cashflowRenderPdfMock.mock.calls[0][0];
    expect(callArgs.charts).toEqual([chart]);
  });

  it("variant=csv returns 200 + application/zip (5 non-empty sections)", async () => {
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "csv", opts: { scenarioId: null, yearStart: 2026, yearEnd: 2030 } }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".zip");
  });

  it("invalid options returns 400", async () => {
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "data", opts: { yearStart: "not-a-number" } }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid options/i);
  });

  it("unknown reportId returns 404", async () => {
    const res = await POST(
      makeReq({ reportId: "nonexistent", variant: "data" }),
      { params },
    );
    expect(res.status).toBe(404);
  });

  it("bogus variant returns 400 (Zod enum rejection)", async () => {
    const res = await POST(
      makeReq({ reportId: "cashflow", variant: "bogus" }),
      { params },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid request body/i);
  });
});
