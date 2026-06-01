import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth, loaders, projection runner, and audit BEFORE importing the route.
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("firm-1"),
  };
});

// The route gained a PDF-export rate-limit guard (audit F11); let it pass so
// tests don't hit the real shared Upstash budget (nondeterministic once spent).
vi.mock("@/lib/rate-limit", () => ({
  checkExportPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkPreviewPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));

vi.mock("@/lib/projection/load-client-data", () => ({
  ClientNotFoundError: class ClientNotFoundError extends Error {
    constructor(clientId: string) {
      super(`client ${clientId} not found`);
      this.name = "ClientNotFoundError";
    }
  },
  ProjectionInputError: class ProjectionInputError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProjectionInputError";
    }
  },
}));

vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTreeForRef: vi.fn().mockResolvedValue({
    effectiveTree: {
      client: { firstName: "Cooper", lastName: "Sample", spouseName: "Susan" },
    },
    warnings: [],
  }),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn().mockReturnValue({ years: [] }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// Firm branding + default cover logo (the route resolves these for the cover).
vi.mock("@/lib/comparison-pdf/branding", () => ({
  resolveBranding: vi.fn().mockResolvedValue({
    primaryColor: "#b87f1f",
    firmName: "Acme Wealth Management",
    logoDataUrl: null,
  }),
}));

vi.mock("@/lib/presentations/default-logo", () => ({
  foundryDefaultLogoDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,AAAA"),
}));

// Keep a benign @/db mock so importing the route doesn't open a real connection.
// The route issues batched scenarios/scenarioSnapshots name lookups via
// db.select(...).from(...).where(...); stub the chain to resolve to no rows
// (labels then fall back to the scenario id, which these audit tests ignore).
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  },
}));

// Replace the document component and renderer so the schema-validation flow
// can reach 200 without actually paginating a PDF in the test environment.
vi.mock("@/components/presentations/document", () => ({
  PresentationDocument: () => null,
}));

vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-pdf/renderer")>();
  return {
    ...actual,
    renderToStream: vi.fn(async () => new ReadableStream()),
  };
});

function makeReq(body: unknown): Request {
  return new Request(
    "http://localhost/api/clients/client-1/presentations/export-pdf",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

describe("POST /api/clients/[id]/presentations/export-pdf — request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty pages array (400)", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq({ scenarioId: null, pages: [] }) as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects the legacy string[] pages shape (400)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({ scenarioId: null, pages: ["cashFlow"] }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a descriptor with an unknown pageId (400)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        pages: [{ pageId: "bogus", options: {} }],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a descriptor missing options (400)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        pages: [{ pageId: "cashFlow" }],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a descriptor with invalid cashFlow options (400)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        pages: [{ pageId: "cashFlow", options: { range: "weird" } }],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body (400)", async () => {
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/clients/client-1/presentations/export-pdf",
      {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "application/json" },
      },
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the client is not in the firm", async () => {
    const { ClientNotFoundError } = await import(
      "@/lib/projection/load-client-data"
    );
    const { loadEffectiveTreeForRef } = await import("@/lib/scenario/loader");
    vi.mocked(loadEffectiveTreeForRef).mockRejectedValueOnce(
      new ClientNotFoundError("client-1"),
    );
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        pages: [
          { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
        ],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/clients/[id]/presentations/export-pdf — descriptor flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the new descriptor shape", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        pages: [
          { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
        ],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    // The schema accepted; no 400. Renderer & document are mocked so this
    // can reach 200 without paginating an actual PDF.
    expect(res.status).not.toBe(400);
  });

  it("audits with pages: pageId[] and hasOverrides=false when no overrides", async () => {
    const { recordAudit } = await import("@/lib/audit");
    const { POST } = await import("../route");
    await POST(
      makeReq({
        scenarioId: "moderate",
        pages: [
          { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
        ],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "presentations.export_pdf",
        metadata: expect.objectContaining({
          pages: ["cashFlow"],
          scenarioId: "moderate",
          hasOverrides: false,
        }),
      }),
    );
  });

  it("audits hasOverrides=true when at least one descriptor has scenarioOverride", async () => {
    const { recordAudit } = await import("@/lib/audit");
    const { POST } = await import("../route");
    await POST(
      makeReq({
        scenarioId: null,
        pages: [
          {
            pageId: "cashFlow",
            options: { range: "retirement", showCallout: true },
            scenarioOverride: "Aggressive",
          },
        ],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ hasOverrides: true }),
      }),
    );
  });

  it("uses a caller-provided filename when supplied", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        scenarioId: null,
        filename: "custom-report.pdf",
        pages: [
          { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
        ],
      }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="custom-report.pdf"');
  });
});

describe("POST /api/clients/[id]/presentations/export-pdf — preview mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const previewBody = {
    scenarioId: null,
    preview: true,
    pages: [
      { pageId: "cashFlow", options: { range: "retirement", showCallout: true } },
    ],
  };

  it("uses the preview limiter, not the export limiter", async () => {
    const { checkExportPdfRateLimit, checkPreviewPdfRateLimit } = await import(
      "@/lib/rate-limit"
    );
    const { POST } = await import("../route");
    await POST(makeReq(previewBody) as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(checkPreviewPdfRateLimit).toHaveBeenCalledWith("firm-1");
    expect(checkExportPdfRateLimit).not.toHaveBeenCalled();
  });

  it("returns an inline Content-Disposition for preview", async () => {
    const { POST } = await import("../route");
    const res = await POST(makeReq(previewBody) as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(res.headers.get("content-disposition") ?? "").toMatch(/^inline/);
  });

  it("audits presentations.preview_pdf in preview mode", async () => {
    const { recordAudit } = await import("@/lib/audit");
    const { POST } = await import("../route");
    await POST(makeReq(previewBody) as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presentations.preview_pdf" }),
    );
  });

  it("still audits presentations.export_pdf when preview is absent", async () => {
    const { recordAudit } = await import("@/lib/audit");
    const { POST } = await import("../route");
    await POST(
      makeReq({ scenarioId: null, pages: previewBody.pages }) as never,
      { params: Promise.resolve({ id: "client-1" }) },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presentations.export_pdf" }),
    );
  });

  it("calls rateLimitErrorResponse and skips audit when preview rate limit is denied", async () => {
    const { checkPreviewPdfRateLimit, rateLimitErrorResponse } = await import(
      "@/lib/rate-limit"
    );
    const { recordAudit } = await import("@/lib/audit");
    const { POST } = await import("../route");
    const rlResult = { allowed: false as const, reason: "exceeded" };
    vi.mocked(checkPreviewPdfRateLimit).mockResolvedValueOnce(rlResult);
    await POST(makeReq(previewBody) as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(rateLimitErrorResponse).toHaveBeenCalledWith(
      rlResult,
      "Too many previews. Please wait a moment and try again.",
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
