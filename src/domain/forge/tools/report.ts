// src/domain/copilot/tools/report.ts
//
// Phase 4 — the `generate_report` forge tool. The model names registry pages
// (+ optional scenarios / Monte Carlo / title); we validate those against the
// live presentation registry, enforce the same fan-out caps the export route
// uses, and enqueue a `generation_runs` row. The actual render runs in the
// BACKGROUND via after() — markRunning → render → savePlanToVault → markDone —
// so the model gets a runId back immediately and the deck lands in the client's
// generated reports once the job finishes.
//
// This is a NON-DESTRUCTIVE enqueue (it writes a queued run + a vault doc, but
// touches no plan data), so it is NOT in WRITE_TOOL_NAMES and does not route
// through the human-approval gate. Like every server-derived surface, it never
// trusts ctx.firmId: it re-derives firmId via requireOrgId() and re-verifies
// client access before queueing.
import { after } from "next/server";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import {
  createQueuedRun,
  markRunning,
  markDone,
  markFailed,
} from "@/lib/crm/generation-runs";
import { BodySchema, renderPresentationPdf } from "@/components/presentations/render-presentation-pdf";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import type { ForgeAuthContext } from "../state";
import type { ForgeToolContext } from "../context";

/** Same fan-out caps the export route enforces. */
const MAX_DISTINCT_SCENARIOS = 6;
const MAX_MC = 3;
/** Pages that drive a Monte Carlo sim per scenario (count toward the MC cap). */
const MONTE_CARLO_PAGE_IDS = new Set(["monteCarlo", "retirementSummary", "retirementComparison"]);

type GenerateReportResult =
  | { runId: string; status: "queued"; pageCount: number }
  | { error: string };

export async function generateReport(
  args: { pageIds: string[]; scenarioIds?: string[]; includeMonteCarlo?: boolean; title?: string },
  ctx: ForgeAuthContext,
  // Part of the mandated tool signature; audit/output ownership is keyed off ctx
  // today, so this is intentionally unused here.
  conversationId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<GenerateReportResult> {
  // Re-derive the firm and re-verify access — never trust ctx.firmId at run time.
  const firmId = await requireOrgId();
  if (!(await verifyClientAccess(ctx.clientId, firmId))) {
    return { error: "Client not found or access denied." };
  }

  const pageIds = args.pageIds ?? [];
  if (pageIds.length === 0) return { error: "No pages requested." };

  // Validate every pageId against the live registry.
  const registry = PRESENTATION_PAGES as Record<
    string,
    { defaultOptions: unknown } | undefined
  >;
  const unknown = pageIds.filter((id) => !registry[id]);
  if (unknown.length > 0) {
    return { error: `Unknown page(s): ${unknown.join(", ")}.` };
  }

  const scenarioIds = args.scenarioIds ?? [];
  if (scenarioIds.length > MAX_DISTINCT_SCENARIOS) {
    return { error: `Too many scenarios — at most ${MAX_DISTINCT_SCENARIOS} distinct scenarios per report.` };
  }

  // Monte Carlo runs once per scenario (or once for the single active ref). It's
  // triggered by any MC-bearing page or an explicit includeMonteCarlo flag.
  const wantsMc = pageIds.some((id) => MONTE_CARLO_PAGE_IDS.has(id)) || args.includeMonteCarlo === true;
  const mcCount = wantsMc ? Math.max(1, scenarioIds.length) : 0;
  if (mcCount > MAX_MC) {
    return { error: `Too many Monte Carlo runs — at most ${MAX_MC} scenarios can include Monte Carlo.` };
  }

  // householdId is the client's crmHouseholdId (firm-scoped) — NOT ctx.clientId.
  const [clientRow] = await db
    .select({ crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, ctx.clientId), eq(clients.firmId, firmId)));
  if (!clientRow?.crmHouseholdId) {
    return { error: "This client isn't linked to a CRM household, so a report can't be queued." };
  }
  const householdId = clientRow.crmHouseholdId;

  // Build the render body from each page's registered defaults, then validate it
  // through BodySchema so it's the same well-typed ExportPdfBody the route hands
  // to renderPresentationPdf (and so each page's options are schema-checked).
  const pages = pageIds.map((pageId) => ({
    pageId,
    options: registry[pageId]!.defaultOptions,
  }));
  const parsed = BodySchema.safeParse({
    scenarioId: scenarioIds[0] ?? null,
    filename: args.title ? `${args.title}.pdf` : undefined,
    preview: false,
    pages,
  });
  if (!parsed.success) {
    return { error: "Could not build a valid report from those pages." };
  }
  const body = parsed.data;

  const runId = await createQueuedRun({
    clientId: ctx.clientId,
    householdId,
    firmId,
    kind: "presentation",
    scenarioId: body.scenarioId,
    triggeredBy: ctx.userId ?? null,
    triggeredByEmail: null,
    requestPayload: body,
  });
  if (!runId) return { error: "Could not queue the report." };

  // Mirror the export route's background job: render + persist to the vault, then
  // mark the run done (or failed). Errors here can't be returned to the model —
  // they surface via the run's status.
  after(async () => {
    try {
      await markRunning(runId);
      const { buffer, filename } = await renderPresentationPdf(ctx.clientId, firmId, body);
      const doc = await savePlanToVault({
        clientId: ctx.clientId,
        firmId,
        reportType: "presentation",
        scenarioId: body.scenarioId,
        filename,
        buffer,
        uploadedBy: ctx.userId ?? null,
      });
      await recordAudit({
        action: "presentations.export_pdf",
        resourceType: "client",
        resourceId: ctx.clientId,
        clientId: ctx.clientId,
        firmId,
        metadata: { pages: body.pages.map((p) => p.pageId), via: "forge" },
      });
      await markDone(runId, doc?.id ?? null);
    } catch (err) {
      await markFailed(runId, err instanceof Error ? err.message : "render failed");
    }
  });

  return { runId, status: "queued", pageCount: pageIds.length };
}

export function buildReportTools({ ctx, conversationId }: ForgeToolContext): StructuredToolInterface[] {
  const generateReportTool = tool(
    async (args) => {
      const r = await generateReport(args, ctx, conversationId);
      return "error" in r ? r.error : JSON.stringify(r);
    },
    {
      name: "generate_report",
      description:
        "Queue a presentation deck (PDF) for the current client from named registry pages. " +
        "Pass pageIds (e.g. 'cover', 'cashFlow', 'monteCarlo'), optional scenarioIds, an " +
        "includeMonteCarlo flag, and an optional title. Returns a runId immediately; the deck " +
        "renders in the background and appears in the client's generated reports. " +
        "Non-destructive — does not require approval. Caps: at most 6 distinct scenarios and " +
        "3 Monte Carlo scenarios.",
      schema: z.object({
        pageIds: z
          .array(z.string())
          .min(1)
          .describe("registry page ids to include, e.g. ['cover', 'cashFlow', 'monteCarlo']"),
        scenarioIds: z
          .array(z.string())
          .optional()
          .describe("scenario uuids to compare; the first is the deck's primary scenario"),
        includeMonteCarlo: z
          .boolean()
          .optional()
          .describe("force a Monte Carlo run even if no MC page is included"),
        title: z.string().optional().describe("optional deck title (becomes the filename)"),
      }),
    },
  );

  return [generateReportTool];
}
