import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, clients, crmHouseholdDocuments, generationRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordAudit } from "@/lib/audit";
import { renderPresentationPdf } from "@/components/presentations/render-presentation-pdf";

// Capture after() callbacks so the test can await the background work
// deterministically instead of racing the real DB.
const { afterTasks, unreviewed } = vi.hoisted(() => ({
  afterTasks: [] as Array<Promise<unknown>>,
  // The soft gate's one DB read, mocked here rather than seeded through real
  // `plan_story_chapters` rows — this suite is about the ROUTE's wiring
  // (audits when told to, stays soft either way), not about the gate's own
  // counting, which `export-gate.test.ts` already covers against the real
  // options schema (`planStoryOptionsSchema`) and `printedChapters`.
  unreviewed: vi.fn(),
}));

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
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, recordAudit: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/presentations/story/export-gate", () => ({
  unreviewedStoryChapters: unreviewed,
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
  vi.mocked(recordAudit).mockClear();
  // Default: no story page in the deck, so the gate has nothing to report —
  // matches `unreviewedStoryChapters`'s own real behaviour for a deck that
  // never mentions "planStory".
  unreviewed.mockReset();
  unreviewed.mockResolvedValue([]);
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

// The spec's decision: "A soft, audited export gate on unreviewed chapters
// rather than a hard block." These tests are about the ROUTE's wiring only —
// that it never refuses an export over the count, that it audits the count
// when there's something to audit, and that it stays silent when there isn't.
// `unreviewedStoryChapters` itself, and its counting rules, are
// `export-gate.test.ts`'s job.
describe("POST /presentations/runs — the soft gate", () => {
  const storyBody = {
    scenarioId: null,
    pages: [{ pageId: "planStory", options: {} }],
  };
  // Reused across every test below rather than repeated per-`it` — one
  // shape, so the fixture cannot drift between the tests that read it.
  const EIGHT_OF_TWELVE = {
    pageId: "planStory",
    scenarioId: "base",
    documentRole: "standalone",
    unreviewed: 8,
    total: 12,
  };

  it("exports anyway, because the gate is soft", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    const res = await POST(req(storyBody), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(202);
  });

  it("puts the count on the JSON response, so the launcher can warn before the file exists", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    const res = await POST(req(storyBody), { params: Promise.resolve({ id: clientId }) });
    const json = await res.json();
    expect(json.storyReview).toEqual([EIGHT_OF_TWELVE]);
  });

  it("audits the unreviewed count, which is what makes it a gate at all", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    await POST(req(storyBody), { params: Promise.resolve({ id: clientId }) });
    // The write is filed from inside after() — see route.ts's own comment on
    // why: an audited row means "this happened", so it fires beside
    // `presentations.export_pdf`, after the render lands, not ahead of it.
    await Promise.all(afterTasks);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plan_story.exported_unreviewed",
        metadata: expect.objectContaining({ unreviewed: 8, total: 12 }),
      }),
    );
  });

  it("files NO such row when every chapter has been read", async () => {
    unreviewed.mockResolvedValue([{ ...EIGHT_OF_TWELVE, unreviewed: 0 }]);
    await POST(req(storyBody), { params: Promise.resolve({ id: clientId }) });
    await Promise.all(afterTasks);
    // Positive control: the export itself still ran and audited normally —
    // proves the assertion below is "the gate stayed silent", not "nothing
    // ran" or "the request failed before any audit call was reachable".
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presentations.export_pdf" }),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.exported_unreviewed" }),
    );
  });

  it("audits on the download=1 branch too — the audit is what carries the compliance weight on both paths", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    const res = await POST(req(storyBody, "?download=1"), {
      params: Promise.resolve({ id: clientId }),
    });
    // Soft: the download still lands...
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // ...but the row is filed anyway (synchronously — this branch has no
    // after() of its own), on the branch whose response cannot carry a
    // `storyReview` payload (it IS the file).
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plan_story.exported_unreviewed",
        metadata: expect.objectContaining({ unreviewed: 8, total: 12 }),
      }),
    );
  });

  it("never audits an export that fails before it renders — 'audited' means it happened", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    vi.mocked(renderPresentationPdf).mockRejectedValueOnce(new Error("render blew up"));
    const res = await POST(req(storyBody), { params: Promise.resolve({ id: clientId }) });
    expect(res.status).toBe(202); // createQueuedRun already ran; the failure is in after()
    await Promise.all(afterTasks);
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.exported_unreviewed" }),
    );
  });

  // The twin of the test above, for the OTHER branch: the ordering guarantee
  // (audit only after a render lands) is a claim about the route, not about
  // one branch of it, and the two branches call `auditUnreviewedStory` from
  // two different places in the file — each needs its own failing-render
  // case to be pinned rather than assumed from the other's.
  it("never audits an export that fails before it renders, on the download=1 branch too", async () => {
    unreviewed.mockResolvedValue([EIGHT_OF_TWELVE]);
    vi.mocked(renderPresentationPdf).mockRejectedValueOnce(new Error("render blew up"));
    const res = await POST(req(storyBody, "?download=1"), {
      params: Promise.resolve({ id: clientId }),
    });
    expect(res.status).toBe(500); // no try/catch of its own on this branch — the outer catch
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.exported_unreviewed" }),
    );
  });
});
