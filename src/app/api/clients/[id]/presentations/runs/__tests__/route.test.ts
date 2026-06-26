import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, crmHouseholdDocuments, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { savePlanToVault } from "@/lib/crm/vault-plans";

// Capture after() callbacks so the test can await the background work
// deterministically instead of racing the real DB.
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as Array<Promise<unknown>> }));

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_runs_rt") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return {
    ...actual,
    auth: vi.fn().mockResolvedValue({ userId: "u", orgId: "org_runs_rt" }),
    currentUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "advisor@firm.com" }] }),
  };
});
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
    authErrorResponse: vi.fn().mockImplementation((err: unknown) => {
      if (err instanceof actual.ForbiddenError) {
        return { status: 403, body: { error: err.message } };
      }
      if (err instanceof Error && (err.name === "UnauthorizedError" || err.message === "Unauthorized")) {
        return { status: 401, body: { error: "Unauthorized" } };
      }
      return null;
    }),
  };
});
vi.mock("@/lib/clients/cross-firm-audit", () => ({
  crossFirmAuditMeta: vi.fn().mockImplementation((_a: unknown, _b: unknown, base?: unknown) => base ?? {}),
}));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterTasks.push(Promise.resolve().then(() => fn()));
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({
  checkExportPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/components/presentations/render-presentation-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/presentations/render-presentation-pdf")>();
  return {
    ...actual,
    renderPresentationPdf: vi.fn().mockResolvedValue({
      buffer: Buffer.from("%PDF-1.7 fake"),
      filename: "smith-presentation.pdf",
      clientLastName: "Smith",
      distinctScenarioCount: 1,
    }),
  };
});
vi.mock("@/lib/crm/vault-plans", () => ({
  savePlanToVault: vi.fn(),
}));

import { POST } from "../route";

const ORG = "org_runs_rt";
let clientId: string;
let documentId: string;

beforeEach(async () => {
  afterTasks.length = 0;
  await db.delete(clients).where(eq(clients.firmId, ORG));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG)); // cascades to docs + runs
  const [h] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  const [c] = await db.insert(clients).values({
    firmId: ORG, advisorId: "u", crmHouseholdId: h.id, retirementAge: 65, planEndAge: 95,
  }).returning();
  clientId = c.id;
  const [d] = await db.insert(crmHouseholdDocuments).values({
    householdId: h.id,
    filename: "smith-presentation.pdf",
    storageProvider: "vercel-blob",
  }).returning();
  documentId = d.id;
  vi.mocked(savePlanToVault).mockClear();
  vi.mocked(savePlanToVault).mockResolvedValue({ id: documentId } as never);
});

function req(body: unknown, query = "") {
  return new Request(`http://t/runs${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("POST presentations/runs", () => {
  const validBody = {
    scenarioId: null,
    pages: [{ pageId: "cashFlow", options: { range: "retirement", showCallout: true } }],
  };

  it("returns 202 with a runId and the run reaches done", async () => {
    const res = await POST(req(validBody), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.runId).toBeTruthy();

    // Drain the after() background work before asserting its effects.
    await Promise.all(afterTasks);

    const [row] = await db.select().from(generationRuns).where(eq(generationRuns.id, json.runId));
    expect(row.status).toBe("done");
    expect(row.kind).toBe("presentation");
    expect(row.triggeredByEmail).toBe("advisor@firm.com");
    expect(row.resultDocumentId).toBe(documentId);
  });

  it("download=1 streams the PDF as an attachment and records a done run", async () => {
    const res = await POST(req(validBody, "?download=1"), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString("utf8")).toContain("%PDF");

    // Saved to the vault as a copy...
    expect(savePlanToVault).toHaveBeenCalledTimes(1);
    // ...and surfaced under Recent runs as an already-done run.
    const rows = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.clientId, clientId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("done");
    expect(rows[0].resultDocumentId).toBe(documentId);
  });

  it("403s for a client outside the firm", async () => {
    const res = await POST(req(validBody), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(403);
  });
});
