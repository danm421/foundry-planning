// src/domain/mcp/presentation-decks.ts
//
// The deck half of the connector's presentation tools: turning Claude's page
// list, or a saved template, into the exact body the app's Generate button
// posts — and refusing, before any run exists, a deck the launcher would block
// or one that would load another household's scenario. Registry logic plus
// three small scoped reads.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, scenarioSnapshots } from "@/db/schema";
import {
  BodySchema,
  deckCapError,
  planDeckScenarios,
  type ExportPdfBody,
} from "@/components/presentations/render-presentation-pdf";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import { BUILTIN_ID_PREFIX, BUILTIN_TEMPLATES } from "@/lib/presentations/builtin-templates";
import { MONTE_CARLO_PAGE_IDS } from "@/lib/presentations/export-page-sets";
import type { TemplateDescriptor } from "@/lib/presentations/template-descriptor-schema";
import { getTemplateById } from "@/lib/presentations/templates-repo";
import type { ScenarioPlan } from "@/lib/scenario/presentation-refs";
import { McpInputError } from "./define-tool";
import { firstForeignScenario, scenarioNotFoundMessage } from "./whatif-jobs";

/** The registry hooks this module reads. Typed loosely on purpose: every
 *  page's options type differs, and these helpers only pass options through. */
interface PageHooks {
  id: string;
  title: string;
  description: string;
  category: string;
  defaultOptions: unknown;
  supportsScenarioOverride: boolean;
  inlineScenarioOption?: { get: (o: never) => string; set: (o: never, scenarioId: string) => unknown };
  planScenarioOption?: { get: (o: never) => string; set: (o: never, scenarioId: string) => unknown };
  isUnconfigured?: (o: never) => boolean;
  unconfiguredHint?: string;
}

const PAGES = PRESENTATION_PAGES as unknown as Record<string, PageHooks>;

/** One page of a deck, in the shape BodySchema takes. */
export interface DeckEntry {
  pageId: string;
  options: unknown;
  scenarioOverride?: string;
}

export const NO_HOUSEHOLD_MESSAGE =
  "This client isn't linked to a CRM household, so Foundry has nowhere to save the deck. Link one in Foundry first.";

const snapshotNotFound = (id: string) => `Snapshot ${id} isn't one of this household's snapshots.`;

/** A registry page by id. Own keys only: `PAGES["constructor"]` must not resolve. */
export function pageFor(pageId: string): PageHooks {
  if (!Object.hasOwn(PAGES, pageId)) {
    throw new McpInputError(`Unknown page "${pageId}". Use list_presentation_pages for page ids.`);
  }
  return PAGES[pageId];
}

/** Every page, with what generate_presentation needs to know about it. */
export function pageCatalog() {
  return Object.values(PAGES).map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    needsMonteCarlo: MONTE_CARLO_PAGE_IDS.has(p.id),
    takesScenario: Boolean(p.supportsScenarioOverride || p.inlineScenarioOption || p.planScenarioOption),
    needsScenario: Boolean(p.inlineScenarioOption),
    needsSetupInFoundry: !p.inlineScenarioOption && (p.isUnconfigured?.(p.defaultOptions as never) ?? false),
  }));
}

/**
 * One deck entry, with a scenario put where this page keeps it — the slot an
 * advisor sets on the Presentations screen:
 *  - a page with a scenario override takes a page-level scenarioId as its
 *    override (the deck's own scenario reaches it as the top-level scenario);
 *  - a comparison page (Plan Changes, Retirement / Tax Comparison) keeps the
 *    compared scenario in its options; a blank one takes the deck's scenario,
 *    the pick an advisor must make before the app will generate it;
 *  - a page that holds its own plan (Roth Conversion Strategy) takes only a
 *    page-level scenarioId.
 * Then the launcher's Generate guard (launcher.tsx, pagesMissingTheirScenario):
 * a page that would print a placeholder is refused, saying why.
 */
export function placePage(input: {
  pageId: string;
  options?: unknown;
  scenarioId?: string;
  deckScenarioId?: string;
}): DeckEntry {
  const page = pageFor(input.pageId);
  const inline = page.inlineScenarioOption;
  let options = input.options ?? page.defaultOptions;
  let scenarioOverride: string | undefined;

  if (input.scenarioId !== undefined) {
    if (page.supportsScenarioOverride) scenarioOverride = input.scenarioId;
    else if (inline) options = inline.set(options as never, input.scenarioId);
    else if (page.planScenarioOption) options = page.planScenarioOption.set(options as never, input.scenarioId);
    else throw new McpInputError(`${page.title} doesn't take a scenario. Leave scenarioId off that page.`);
  } else if (inline && !inline.get(options as never) && input.deckScenarioId && input.deckScenarioId !== "base") {
    options = inline.set(options as never, input.deckScenarioId);
  }

  if (inline && !inline.get(options as never)) {
    throw new McpInputError(
      `${page.title} compares the plan with a scenario. Pass scenarioId on that page, or for the whole deck.`,
    );
  }
  if (!inline && page.isUnconfigured?.(options as never)) {
    throw new McpInputError(
      `${page.title} can't be generated as it is set up: ${page.unconfiguredHint ?? "choose its scenarios first."} ` +
        "Build that page in Foundry's Presentations screen, or leave it out.",
    );
  }
  return { pageId: input.pageId, options, ...(scenarioOverride !== undefined ? { scenarioOverride } : {}) };
}

/**
 * A template's pages: a built-in (`builtin:<slug>`), or a firm template that is
 * shared or the caller's own. Anything else is "not found" — another advisor's
 * private template is never confirmed to exist.
 */
export async function templatePages(templateId: string, firmId: string, userId: string): Promise<TemplateDescriptor[]> {
  const notFound = () =>
    new McpInputError(`Template ${templateId} not found. Use list_presentation_pages for template ids.`);
  if (templateId.startsWith(BUILTIN_ID_PREFIX)) {
    const builtIn = BUILTIN_TEMPLATES.find((t) => `${BUILTIN_ID_PREFIX}${t.slug}` === templateId);
    if (!builtIn) throw notFound();
    return builtIn.pages;
  }
  if (!z.string().uuid().safeParse(templateId).success) throw notFound();
  const row = await getTemplateById(templateId, firmId);
  if (!row || (row.visibility !== "shared" && row.createdByUserId !== userId)) throw notFound();
  return row.pages;
}

/**
 * The body the Generate button would post, and its scenario plan — refused
 * here when it breaks the render's own caps, so no run is queued for a deck
 * that could only fail in the background.
 */
export function buildDeckBody(input: {
  entries: DeckEntry[];
  deckScenarioId?: string;
  title?: string;
}): { body: ExportPdfBody; plan: ScenarioPlan } {
  const deck = input.deckScenarioId;
  const parsed = BodySchema.safeParse({
    // generation_runs.scenario_id is a uuid column: the base case is null there.
    scenarioId: deck && deck !== "base" ? deck : null,
    ...(input.title ? { filename: `${input.title}.pdf` } : {}),
    preview: false,
    pages: input.entries,
  });
  if (!parsed.success) {
    throw new McpInputError(
      "Foundry couldn't build a deck from those pages as they are saved. Open the template in Foundry and save it " +
        "again, or choose pages from list_presentation_pages.",
    );
  }
  const plan = planDeckScenarios(parsed.data);
  const capError = deckCapError(plan);
  if (capError) throw new McpInputError(capError);
  return { body: parsed.data, plan };
}

/** Keys a page's options name a scenario under: scenarioId, baselineScenarioId, scenarioIds. */
const SCENARIO_KEY = /scenarioids?$/i;

/**
 * Every scenario and snapshot id this deck would load or print: the scenario
 * plan's refs, plus any page option that names one. A Plan Story's own
 * `scenarioId` never enters the plan (story/scenario-label.ts), so the plan
 * alone would miss it.
 */
export function deckRefIds(body: ExportPdfBody, plan: ScenarioPlan): { scenarioIds: string[]; snapshotIds: string[] } {
  const scenarioIds = new Set<string>();
  const snapshotIds = new Set<string>();
  const add = (raw: string) => {
    if (!raw || raw === "base") return;
    if (raw.startsWith("snap:")) snapshotIds.add(raw.slice("snap:".length));
    else scenarioIds.add(raw);
  };
  for (const { ref } of plan.distinct.values()) {
    if (ref.kind === "snapshot") snapshotIds.add(ref.id);
    else add(ref.id);
  }
  const walk = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (SCENARIO_KEY.test(key)) add(value);
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v, key);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  for (const page of body.pages) walk(page.options, "");
  return { scenarioIds: [...scenarioIds], snapshotIds: [...snapshotIds] };
}

/**
 * Refuse, before any run exists, a scenario or snapshot that isn't this
 * client's — whether it came from Claude (a page's or the deck's scenarioId) or
 * from a saved template's options (Review Focus 5). Scenarios go through the
 * what-if tools' own check (one query, one sentence).
 */
export async function assertDeckRefsOwned(
  clientId: string,
  refs: { scenarioIds: string[]; snapshotIds: string[] },
): Promise<void> {
  const foreignScenario = await firstForeignScenario(clientId, refs.scenarioIds);
  if (foreignScenario !== null) throw new McpInputError(scenarioNotFoundMessage(foreignScenario));

  const badSnapshot = refs.snapshotIds.find((id) => !z.string().uuid().safeParse(id).success);
  if (badSnapshot) throw new McpInputError(snapshotNotFound(badSnapshot));
  if (refs.snapshotIds.length > 0) {
    const rows = await db
      .select({ id: scenarioSnapshots.id })
      .from(scenarioSnapshots)
      .where(and(eq(scenarioSnapshots.clientId, clientId), inArray(scenarioSnapshots.id, refs.snapshotIds)));
    const owned = new Set(rows.map((r) => r.id));
    const missing = refs.snapshotIds.find((id) => !owned.has(id));
    if (missing) throw new McpInputError(snapshotNotFound(missing));
  }
}

/** The CRM household this client's decks are listed and saved under, or null. */
export async function householdIdFor(clientId: string, firmId: string): Promise<string | null> {
  const [row] = await db
    .select({ householdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return row?.householdId ?? null;
}
