// src/domain/mcp/tools/presentations.ts
//
// Standard Foundry decks from Claude: the page and template catalog, queueing a
// deck into the household's documents, and checking on it — plus one page's data
// and the household's branding, for a deck Claude builds itself. The deck is queued
// exactly as the app's Generate button queues it (src/lib/presentations/
// queue-run.ts); presentation-decks.ts turns Claude's request into that body.
import { z } from "zod";
import { buildReportPageData } from "@/components/presentations/page-data";
import { loadHouseholdBrand } from "@/lib/branding/household-brand";
import { resolveBrandingForClient, resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { getRunForHousehold } from "@/lib/crm/generation-runs";
import { foundryDocumentUrl } from "@/lib/mcp/foundry-url";
import { partitionBuiltInRows } from "@/lib/presentations/builtin-templates";
import { listDismissedSlugs } from "@/lib/presentations/builtin-templates-repo";
import { DISCLOSURES_HEADING, longDisclaimerParagraphs, SHORT_DISCLAIMER } from "@/lib/presentations/disclaimers";
import { dateLong } from "@/lib/presentations/format";
import { queuePresentationRun, recordUnreviewedStoryAudits } from "@/lib/presentations/queue-run";
import { unreviewedStoryChapters, type UnreviewedStoryPage } from "@/lib/presentations/story/export-gate";
import { loadPlanFacts } from "@/lib/presentations/suggestions/load-plan-facts";
import { scoreReports } from "@/lib/presentations/suggestions/score-reports";
import { listTemplatesForUser } from "@/lib/presentations/templates-repo";
import { checkExportPdfRateLimit } from "@/lib/rate-limit";
import { MAX_DISTINCT_SCENARIOS, MAX_MC_SCENARIOS } from "@/lib/scenario/presentation-refs";
import {
  defineTool,
  defineWriteTool,
  McpInputError,
  McpRateLimitedError,
  McpUnavailableError,
  type McpTool,
} from "../define-tool";
import {
  assertDeckRefsOwned,
  buildDeckBody,
  deckRefIds,
  householdIdFor,
  NO_HOUSEHOLD_MESSAGE,
  pageCatalog,
  pageFor,
  placePage,
  templatePages,
} from "../presentation-decks";
import { assertWithinSize } from "./projection-data";

export const RUN_NOT_FOUND_MESSAGE =
  "Deck run not found for this household. Use the runId generate_presentation returned.";
export const RENDER_FAILED_MESSAGE =
  "The deck couldn't be generated. Try again, or build it on the Presentations page in Foundry.";
export const DECK_NOT_SAVED_MESSAGE =
  "The deck rendered but couldn't be saved to the household's documents. Generate it again.";

/** The soft export gate's warning, one per Plan Story page with chapters no
 *  advisor has reviewed — for a deck Foundry renders or one Claude builds. */
function unreviewedStoryNotes(storyReview: UnreviewedStoryPage[]): string[] {
  return storyReview
    .filter((s) => s.unreviewed > 0)
    .map(
      (s) =>
        `The Plan Story has ${s.unreviewed} of ${s.total} chapters no advisor has reviewed yet. Tell the advisor before they share the deck.`,
    );
}

const clientIdArg = z
  .string()
  .describe("Planning client id from search_clients (the clientId field, present only when hasPlan is true). NOT a CRM household id.");

const listPresentationPages = defineTool({
  name: "list_presentation_pages",
  title: "List presentation pages",
  description:
    "The standard Foundry deck pages and templates generate_presentation can use, plus the pages Foundry suggests " +
    "for this household's plan. For each page: needsMonteCarlo (slower to render), takesScenario (accepts a " +
    "scenarioId), needsScenario (a comparison page: it must be given the scenario to compare with the base case), " +
    "needsSetupInFoundry (can only be generated from Foundry's Presentations screen). Templates are Foundry's " +
    "built-ins (ids starting 'builtin:'), the firm's shared templates and the advisor's own. To build a custom deck " +
    "yourself, use get_report_page_data and get_branding instead.",
  inputSchema: z.object({ clientId: clientIdArg }),
  page: "presentations",
  handler: async ({ clientId }, { principal, firmId }) => {
    const [dismissed, firm, suggested] = await Promise.all([
      listDismissedSlugs(firmId, principal.userId),
      listTemplatesForUser(firmId, principal.userId),
      loadPlanFacts(clientId, firmId, "base")
        .then((facts) => scoreReports(facts).map((s) => ({ pageId: s.pageId, reason: s.reason })))
        .catch((err): { pageId: string; reason: string }[] => {
          // Suggestions are a convenience; the catalog must still answer.
          console.error("[mcp] list_presentation_pages: suggestions failed", err);
          return [];
        }),
    ]);
    const summary =
      (kind: "built_in" | "shared" | "mine") =>
      (t: { id: string; name: string; pages: ReadonlyArray<{ pageId: string }> }) => ({
        id: t.id,
        name: t.name,
        kind,
        pageIds: t.pages.map((p) => p.pageId),
      });

    return {
      pages: pageCatalog(),
      templates: [
        ...partitionBuiltInRows(dismissed).builtIn.map(summary("built_in")),
        ...firm.shared.map(summary("shared")),
        ...firm.mine.map(summary("mine")),
      ],
      suggested,
    };
  },
});

const generatePresentation = defineWriteTool({
  name: "generate_presentation",
  title: "Generate a presentation",
  description:
    "Generate a standard Foundry deck (PDF) for a household and save it to the household's documents in Foundry. " +
    "Give templateId (from list_presentation_pages) or pages — a list of { pageId, scenarioId? } in order — not both. " +
    "scenarioId sets the deck's scenario (default: the base case). On a comparison page (needsScenario) a scenarioId " +
    "is the scenario compared with the base case, and a comparison page left blank takes the deck's scenario. Pages " +
    "use their standard settings, or the template's. " +
    `At most ${MAX_DISTINCT_SCENARIOS} different scenarios per deck, ${MAX_MC_SCENARIOS} of them with Monte Carlo ` +
    "pages. The deck renders in the background, usually in 1–5 minutes: this returns a runId — call " +
    "get_presentation_status with it for the link. To put a what-if in a deck, save it first with " +
    "save_what_if_as_scenario. Needs the firm's 'Claude connector changes' setting turned on (a firm admin does " +
    "this in Settings → Firm) and edit access to the household.",
  inputSchema: z.object({
    clientId: clientIdArg,
    title: z.string().trim().min(1).max(100).optional().describe("Deck title; becomes the file name."),
    scenarioId: z.string().optional().describe("The deck's scenario, from list_scenarios. Omit for the base case."),
    templateId: z.string().min(1).max(100).optional().describe("A template id from list_presentation_pages."),
    pages: z
      .array(z.object({ pageId: z.string().min(1).max(60), scenarioId: z.string().optional() }))
      .min(1)
      .max(40)
      .optional()
      .describe("Pages in order, by id from list_presentation_pages."),
  }),
  page: "presentations",
  handler: async ({ clientId, title, scenarioId, templateId, pages }, { principal, firmId }) => {
    if ((templateId === undefined) === (pages === undefined)) {
      throw new McpInputError("Give templateId or pages — exactly one of them.");
    }
    const entries =
      templateId !== undefined
        ? (await templatePages(templateId, firmId, principal.userId)).map((p) =>
            placePage({ pageId: p.pageId, options: p.options, deckScenarioId: scenarioId }),
          )
        : (pages ?? []).map((p) => placePage({ pageId: p.pageId, scenarioId: p.scenarioId, deckScenarioId: scenarioId }));

    const { body, plan } = buildDeckBody({ entries, deckScenarioId: scenarioId, title });
    await assertDeckRefsOwned(clientId, deckRefIds(body, plan));
    const householdId = await householdIdFor(clientId, firmId);
    if (!householdId) throw new McpInputError(NO_HOUSEHOLD_MESSAGE);

    // The runs route's limiter, checked after validation as the route does.
    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) throw new McpRateLimitedError(rl.reason);

    const { runId, storyReview } = await queuePresentationRun({
      clientId,
      firmId,
      householdId,
      body,
      triggeredBy: principal.userId,
      triggeredByEmail: null,
      // No session behind a connector call: the advisor is named explicitly,
      // and the AI commentary resolves for the token's verified firm (the
      // client's own — the guard refuses a cross-firm client).
      auditActorId: principal.userId,
      auditMetadata: {},
      via: "claude",
      aiCallerOrgId: firmId,
      // Claude polls by runId: a deck with no run would be unfindable, and the
      // retry the unavailable answer invites would render it twice.
      requireRun: true,
    });
    if (!runId) throw new McpUnavailableError();

    const notes = unreviewedStoryNotes(storyReview);
    return {
      runId,
      status: "queued" as const,
      pageCount: body.pages.length,
      expectedMinutes: "1–5",
      message: "Queued. Call get_presentation_status with this runId in a minute or two.",
      ...(notes.length > 0 ? { notes } : {}),
    };
  },
  auditMetadata: (args, result) => ({
    runId: result.runId,
    pageCount: result.pageCount,
    ...(args.templateId ? { templateId: args.templateId } : {}),
  }),
});

const getPresentationStatus = defineTool({
  name: "get_presentation_status",
  title: "Get presentation status",
  description:
    "Check on a deck queued by generate_presentation: status running, done or failed. When done, downloadUrl is a " +
    "Foundry link to the PDF in the household's documents — it opens only for someone signed in to Foundry, so it " +
    "is for the advisor, not the client. While running, call again in a minute.",
  inputSchema: z.object({ clientId: clientIdArg, runId: z.string().min(1).max(100) }),
  page: "presentations",
  handler: async ({ clientId, runId }, { firmId }) => {
    if (!z.string().uuid().safeParse(runId).success) throw new McpInputError(RUN_NOT_FOUND_MESSAGE);
    const householdId = await householdIdFor(clientId, firmId);
    // getRunForHousehold scopes by household AND firm, and sweeps a stale run to failed.
    const run = householdId ? await getRunForHousehold(runId, householdId, firmId) : null;
    if (!householdId || !run || run.clientId !== clientId || run.kind !== "presentation") {
      throw new McpInputError(RUN_NOT_FOUND_MESSAGE);
    }
    const requested = (run.requestPayload as { pages?: unknown[] } | null)?.pages;
    const pageCount = Array.isArray(requested) ? requested.length : null;

    if (run.status === "done") {
      return run.resultDocumentId
        ? {
            status: "done",
            pageCount,
            downloadUrl: foundryDocumentUrl(householdId, run.resultDocumentId),
            note: "The link needs a Foundry sign-in.",
          }
        : { status: "failed", error: DECK_NOT_SAVED_MESSAGE };
    }
    // Never the run's own error text: it is an internal message, not model-safe.
    if (run.status === "failed") return { status: "failed", error: RENDER_FAILED_MESSAGE };
    return { status: "running", message: "Still generating. Check again in a minute." };
  },
});

export const PAGE_TOO_LARGE_ADVICE =
  "Use get_projection_data with fewer sections or a shorter year range instead.";

const getReportPageData = defineTool({
  name: "get_report_page_data",
  title: "Get report page data",
  description:
    "The exact data one standard Foundry deck page prints — the same numbers as the PDF sheet — for a deck you build " +
    "yourself. pageId comes from list_presentation_pages. scenarioId works as in generate_presentation: the page's " +
    "scenario, and the one a comparison page (needsScenario) compares with the base case. Logos and other images are " +
    "left out: get the logo URL, brand colour and disclaimer text from get_branding. The commentary Foundry writes " +
    "while rendering a deck (the AI summaries on the Retirement Comparison, Scenario Comparison and Investment " +
    "Proposal pages) is not included. A Plan Story page's chapters are included as stored, and notes says when an " +
    "advisor hasn't reviewed some of them. A Monte Carlo or comparison page can take up to a minute the first time. " +
    "For the engine's year-by-year output instead of a page, use get_projection_data.",
  inputSchema: z.object({
    clientId: clientIdArg,
    pageId: z.string().min(1).max(60),
    scenarioId: z.string().optional().describe("A scenario from list_scenarios. Omit for the base case."),
  }),
  page: "presentations",
  handler: async ({ clientId, pageId, scenarioId }, { principal, firmId }) => {
    const entry = placePage({ pageId, scenarioId, deckScenarioId: scenarioId });
    const { body, plan } = buildDeckBody({ entries: [entry], deckScenarioId: scenarioId });
    await assertDeckRefsOwned(clientId, deckRefIds(body, plan));
    const result = {
      pageId,
      title: pageFor(pageId).title,
      scenarioId: scenarioId ?? "base",
      data: await buildReportPageData(clientId, firmId, body),
    };
    assertWithinSize(result, PAGE_TOO_LARGE_ADVICE);

    // A Plan Story page hands over its stored chapters, reviewed or not: the
    // soft export gate (story/export-gate.ts) warns and audits here as it does
    // for a rendered deck. Filed now, as the data is about to go out.
    const storyReview = await unreviewedStoryChapters(clientId, body.pages);
    await recordUnreviewedStoryAudits({
      storyReview,
      clientId,
      firmId,
      actorId: principal.userId,
      metadata: { via: "claude", tool: "get_report_page_data" },
    });
    const notes = unreviewedStoryNotes(storyReview);
    return { ...result, ...(notes.length > 0 ? { notes } : {}) };
  },
});

const getBranding = defineTool({
  name: "get_branding",
  title: "Get branding",
  description:
    "The household's brand, for a deck you build yourself: brandName (the firm, or the advisor's own brand when the " +
    "household uses it), accentColor (hex), logoUrl (a public image URL, or null when the brand has no logo — " +
    "Foundry's own decks print the Foundry logo then; choose what suits your deck, such as the brand name as a " +
    "wordmark), and Foundry's standard disclaimer text exactly as Foundry decks print it (a short footer line, a " +
    "heading and the long paragraphs). Foundry stores no firm-specific compliance disclosures: ask the advisor " +
    "whether their firm requires any.",
  inputSchema: z.object({ clientId: clientIdArg }),
  handler: async ({ clientId }, { firmId }) => {
    const [brand, contact] = await Promise.all([
      loadHouseholdBrand(clientId, firmId),
      getClientWithContacts(clientId, firmId),
    ]);
    const [branding, web] = await Promise.all([
      resolveBrandingForClient(firmId, brand),
      resolveIntakeBrandingForClient(firmId, brand),
    ]);
    const clientName = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "the client";
    return {
      brandName: branding.firmName,
      accentColor: branding.primaryColor,
      // Already public — the household's intake pages show it to anyone with the
      // link. The PDF path's logoDataUrl (base64 bytes) is never returned.
      logoUrl: web?.logoUrl ?? null,
      disclaimers: {
        short: SHORT_DISCLAIMER,
        heading: DISCLOSURES_HEADING,
        long: longDisclaimerParagraphs({ firmName: branding.firmName, clientName, reportDate: dateLong(new Date()) }),
      },
    };
  },
});

export const presentationTools: McpTool[] = [
  listPresentationPages,
  generatePresentation,
  getPresentationStatus,
  getReportPageData,
  getBranding,
];
