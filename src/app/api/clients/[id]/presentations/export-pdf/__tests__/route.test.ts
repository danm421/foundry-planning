import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth, loaders, projection runner, and audit BEFORE importing the route.
vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn().mockResolvedValue("firm-1"),
  };
});

vi.mock("@/lib/projection/load-client-data", () => ({
  loadClientData: vi.fn(),
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

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn().mockReturnValue({ years: [] }),
}));

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

// We do NOT mock @react-pdf/renderer — schema-validation tests reject the body
// before any rendering happens, so the renderer is never invoked.

describe("POST /api/clients/[id]/presentations/export-pdf — request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty pages array (400)", async () => {
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/clients/client-1/presentations/export-pdf",
      {
        method: "POST",
        body: JSON.stringify({ scenarioId: null, pages: [] }),
        headers: { "content-type": "application/json" },
      },
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown page id (400)", async () => {
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/clients/client-1/presentations/export-pdf",
      {
        method: "POST",
        body: JSON.stringify({ scenarioId: null, pages: ["bogus"] }),
        headers: { "content-type": "application/json" },
      },
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
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
    const { loadClientData, ClientNotFoundError } = await import(
      "@/lib/projection/load-client-data"
    );
    vi.mocked(loadClientData).mockRejectedValueOnce(
      new ClientNotFoundError("client-1"),
    );
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/clients/client-1/presentations/export-pdf",
      {
        method: "POST",
        body: JSON.stringify({ scenarioId: null, pages: ["cashFlow"] }),
        headers: { "content-type": "application/json" },
      },
    );
    const res = await POST(req as never, {
      params: Promise.resolve({ id: "client-1" }),
    });
    expect(res.status).toBe(404);
  });
});
