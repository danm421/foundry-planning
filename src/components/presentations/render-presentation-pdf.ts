import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { resolveBranding } from "@/lib/branding/branding";
import { resolveBrandingForClient } from "@/lib/branding/resolve-for-client";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import { runProjectionWithEvents } from "@/engine/projection";
import { applyMutations } from "@/lib/solver/apply-mutations";
import {
  buildDerivedBundle,
  entryDerivedKey,
  type DerivedDeps,
  type DerivedRefRequest,
} from "@/lib/presentations/derived-refs";
import {
  PresentationDocument,
  type PageScenarioBundle,
} from "@/components/presentations/document";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { dateLong } from "@/lib/presentations/format";
import { loadInvestmentsBundle } from "@/lib/presentations/investments-bundle";
import { loadLifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { loadClientObservationRows } from "@/lib/observations/load-rows";
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import { getOrComputeLifeInsuranceSolve } from "@/lib/compute-cache/life-insurance";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import type {
  LifeInsuranceSummaryOptions,
  LiSolved,
} from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { PlanStoryOptions } from "@/lib/presentations/pages/plan-story/options-schema";
import { loadPlanStoryInput } from "@/lib/presentations/story/load-for-export";
import { loadInvestmentProposalBundle } from "@/lib/presentations/investment-proposal-bundle";
import type { InvestmentProposalOptions } from "@/lib/presentations/pages/investment-proposal/options-schema";
import { loadStoryScenarioLabel } from "@/lib/presentations/story/scenario-label";
import {
  planScenarioBundles,
  keyForRef,
  resolveScenarioRef,
  MAX_DISTINCT_SCENARIOS,
  MAX_MC_SCENARIOS,
  type PlannerPage,
} from "@/lib/scenario/presentation-refs";
import { loadPageScenarioBundles } from "@/lib/scenario/load-page-bundles";
import { plannerFlagsFor } from "@/lib/presentations/export-page-sets";
import React from "react";

const PAGE_IDS = Object.keys(PRESENTATION_PAGES) as [
  PresentationPageId,
  ...PresentationPageId[],
];

// Per-pageId descriptor: options is validated against the page's
// registered optionsSchema, plus an optional scenarioOverride label.
// With only one registered page today, this collapses to a single object
// schema; when a 2nd page lands it auto-promotes to a discriminatedUnion.
const descriptorVariants = PAGE_IDS.map((pid) =>
  z.object({
    pageId: z.literal(pid),
    options: PRESENTATION_PAGES[pid].optionsSchema,
    scenarioOverride: z.string().nullable().optional(),
  }),
);
const pageDescriptorSchema =
  descriptorVariants.length === 1
    ? descriptorVariants[0]
    : z.discriminatedUnion(
        "pageId",
        descriptorVariants as unknown as [
          (typeof descriptorVariants)[number],
          ...(typeof descriptorVariants)[number][],
        ],
      );

export const BodySchema = z.object({
  scenarioId: z.string().nullable().default(null),
  filename: z.string().trim().min(1).max(120).optional(),
  preview: z.boolean().optional().default(false),
  pages: z.array(pageDescriptorSchema).min(1),
});

export type ExportPdfBody = z.infer<typeof BodySchema>;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface DerivablePage {
  pageId: string;
  options: unknown;
  requiredDerivedRefs?: (options: never) => DerivedRefRequest[];
}

// The real engine + solver, injected rather than imported by
// `derived-refs.ts`: that module is reached from "use client" launcher
// components through the registry (`launcher/selected-page-row.tsx` and
// `launcher/report-command-palette.tsx` both open with "use client" and import
// it), so a value import of the projection there would drag the engine into the
// browser bundle. This file is server-only, so it owns the real wiring.
const REAL_DERIVED_DEPS: DerivedDeps = {
  applyMutations,
  runProjection: runProjectionWithEvents,
};

/**
 * Returns a NEW record: every loaded scenario bundle, plus one derived bundle
 * per variant any page ENTRY asked for. Loaded bundles are passed through by
 * reference — a `ProjectionResult` is megabytes, and nothing downstream mutates
 * one.
 *
 * Keyed per entry, not per page id: a deck may contain the same page twice with
 * different options, and both entries name the same variant `key`. See
 * `entryDerivedKey`. `document.tsx` re-keys each entry's slice back to the
 * index-free form before a page sees it.
 *
 * Derived variants are pure compute against a tree that is already loaded, so
 * this runs long after `planScenarioBundles` and the MAX_DISTINCT_SCENARIOS /
 * MAX_MC_SCENARIOS checks — it cannot inflate either count.
 *
 * A variant whose `from` ref was not loaded is skipped rather than thrown —
 * the page renders its empty state, which is a better failure than a 500 on an
 * export the advisor has already waited on.
 */
export function resolveDerivedBundles(
  pages: DerivablePage[],
  loaded: Record<string, PageScenarioBundle>,
  deps: DerivedDeps = REAL_DERIVED_DEPS,
): Record<string, PageScenarioBundle> {
  const out: Record<string, PageScenarioBundle> = { ...loaded };
  pages.forEach((p, idx) => {
    if (!p.requiredDerivedRefs) return;
    for (const req of p.requiredDerivedRefs(p.options as never)) {
      // `resolveScenarioRef` maps any unknown token to a well-formed ref and
      // never throws, so an absent source simply misses the record lookup.
      const source = loaded[keyForRef(resolveScenarioRef(req.from))];
      if (!source) continue;
      out[entryDerivedKey(idx, p.pageId, req.key)] = buildDerivedBundle(source, req, deps);
    }
  });
  return out;
}

/**
 * Render a presentation deck to a PDF buffer. Throws ClientNotFoundError /
 * ProjectionInputError (callers map to 404/422) or an Error with a
 * "Too many … scenarios" message (callers map to 400). No rate-limit, no
 * audit, no vault write — callers own those.
 */
export async function renderPresentationPdf(
  clientId: string,
  firmId: string,
  body: ExportPdfBody,
): Promise<{ buffer: Buffer; filename: string; clientLastName: string; distinctScenarioCount: number }> {
  // Plan the distinct set of scenarios this deck needs. Pages that don't
  // support an override, or whose override is undefined ("Default"), follow
  // the top-level scenario.
  const plannerPages: PlannerPage[] = body.pages.map((p) => {
    const page = PRESENTATION_PAGES[p.pageId];
    const requiredRefs = page.requiredScenarioRefs
      ? page.requiredScenarioRefs(p.options as never)
      : undefined;
    return {
      supportsScenarioOverride: page.supportsScenarioOverride,
      scenarioOverride: p.scenarioOverride,
      // Both flags come from `export-page-sets`, which the Forge tool reads too.
      ...plannerFlagsFor(p.pageId),
      requiredRefs,
    };
  });
  const plan = planScenarioBundles(plannerPages, body.scenarioId);

  if (plan.distinct.size > MAX_DISTINCT_SCENARIOS) {
    throw new Error(
      `Too many distinct scenarios in one deck (${plan.distinct.size}). Limit is ${MAX_DISTINCT_SCENARIOS}.`,
    );
  }
  const mcCount = [...plan.distinct.values()].filter((d) => d.needsMonteCarlo).length;
  if (mcCount > MAX_MC_SCENARIOS) {
    throw new Error(
      `Too many scenarios with a Monte Carlo page (${mcCount}). Limit is ${MAX_MC_SCENARIOS}.`,
    );
  }

  // Conditionally load the investments bundle — only when the deck includes
  // at least one investment page, to avoid unnecessary DB queries.
  const hasHoldingsPage = body.pages.some((p) => p.pageId === "holdings");
  const needsInvestments =
    hasHoldingsPage ||
    body.pages.some(
      (p) =>
        p.pageId === "assetAllocation" ||
        p.pageId === "portfolioAnalysis" ||
        p.pageId === "assumptions",
    );
  const investments = needsInvestments
    ? (await loadInvestmentsBundle(clientId, firmId, {
        includeHoldings: hasHoldingsPage,
      })) ?? undefined
    : undefined;

  // Memoize the firm's investment-option catalog across the request — both the
  // per-scenario reinvestment enrichment and the Life Insurance block below
  // consume it, and it's a multi-query bundle load. Lazily loaded on first use.
  let investmentCatalog: ReturnType<typeof listInvestmentOptionCatalog> | null = null;
  const getInvestmentCatalog = () =>
    (investmentCatalog ??= listInvestmentOptionCatalog(clientId, firmId));

  // Build one bundle per distinct scenario. Shared with the Scenario Comparison
  // AI generator (src/lib/scenario/load-page-bundles.ts), which needs the same
  // columns built the same way; it also owns the ClientNotFoundError /
  // ProjectionInputError mapping this route's caller catches, and resolves the
  // scenario + snapshot display names.
  const bundles = await loadPageScenarioBundles({
    clientId,
    firmId,
    requests: [...plan.distinct.values()],
    getInvestmentCatalog,
    logContext: "POST /clients/[id]/presentations/export-pdf",
  });

  // Max sustainable spending: each page that wants one declares the refs and
  // the confidence target via its `maxSpendRefs` hook, and the solve attaches
  // to the bundle for every ref it names.
  // Unlike the Life-Insurance pass below (whose solve is page-specific and is
  // injected into page.options), max-spend depends only on (scenario, target),
  // so it attaches to the shared bundle — one solve serves every page on it.
  // Cached (kind="max_spending") so repeated decks / the AI route are cheap.
  const maxSpendDone = new Set<string>(); // `${key}:${target}`
  await Promise.all(
    body.pages.flatMap((page) => {
      const def = PRESENTATION_PAGES[page.pageId];
      const req = def.maxSpendRefs?.(page.options as never) ?? null;
      if (!req) return [];
      return req.refs.map(async (raw) => {
        // Resolve to the same keys planScenarioBundles registered so we attach
        // to the exact bundle objects the PDF renderer will read.
        const ref = resolveScenarioRef(raw);
        // Only base and live scenarios have a solvable scenario id. A snapshot
        // would be solved as Base Case and that figure attached to the
        // SNAPSHOT's bundle — a wrong number under a snapshot's name on a
        // client-facing sheet, which is worse than a missing row. No page's
        // picker offers a snapshot here, so no configurable path changes.
        // (Mirrors the `d.ref.kind === "scenario"` guard on scenario-changes
        // above. The pre-existing block passed opts.scenarioId to the solver
        // raw, so this hole predates the refactor that made it visible.)
        if (ref.kind !== "scenario") return;
        const key = keyForRef(ref);
        const dedupe = `${key}:${req.targetPoS}`;
        if (maxSpendDone.has(dedupe) || !bundles[key]) return;
        maxSpendDone.add(dedupe);
        try {
          bundles[key].maxSpend = await getOrComputeMaxSpending({
            clientId,
            firmId,
            // Narrowed to the scenario arm by the guard above; `ref.id` is
            // "base" for the base column, exactly as before.
            scenarioId: ref.id,
            targetPoS: req.targetPoS,
          });
        } catch (msErr) {
          console.error("Max-spend solve failed for export", msErr);
          bundles[key].maxSpend = null; // page degrades to a hidden row
        }
      });
    }),
  );

  // The cover/client-name fields come from the top-level bundle.
  const topBundle = bundles[plan.topKey];
  const ci = topBundle.clientData.client;
  const clientLastName = ci.lastName ?? "";
  const spouseFirstName = ci.spouseName ?? null;
  const clientFullName = `${ci.firstName} ${clientLastName}`.trim();

  // The spouse's surname lives only on the CRM contact (the engine client
  // carries just `spouseName` = first name). Load it so the cover + Client
  // Profile page can show the spouse's real last name when it differs from
  // the primary's. One extra query, only when there's a spouse.
  const spouseLastName = spouseFirstName
    ? (await getClientWithContacts(clientId, firmId))?.spouseLastName ?? null
    : null;
  // Compact running-header name: both first names for a couple ("Alan &
  // Teresa"), full primary name for a solo client. Distinct from the formal
  // household name used on the cover/disclaimer.
  const headerName = spouseFirstName
    ? `${ci.firstName} & ${spouseFirstName}`.trim()
    : clientFullName;

  // Conditionally load the life insurance inventory — only when the deck
  // includes the Life Insurance Summary page.
  const needsLifeInsurance = body.pages.some(
    (p) => p.pageId === "lifeInsuranceSummary",
  );
  const lifeInsurance = needsLifeInsurance
    ? await loadLifeInsuranceInventory(clientId, firmId, clientFullName, spouseFirstName)
    : undefined;

  // Conditionally load observation/next-step rows — only when the deck
  // includes the Observations & Next Steps page. Org-scoping note: clientId +
  // firmId were already proven by loadEffectiveTreeForRef above; see
  // `load-rows.ts` for what the query itself adds.
  const needsObservations = body.pages.some((p) => p.pageId === "observationsNextSteps");
  const observations = needsObservations ? await loadClientObservationRows(clientId) : undefined;

  // Load the Plan Story — one payload PER ENTRY, index-aligned with
  // `body.pages`. The chapter prose comes out of storage, never from the model:
  // generation runs in the review panel ahead of the meeting, so an export is
  // never slower or more expensive because a chapter happened to be missing.
  //
  // Per entry rather than per page id, unlike the `observations` load above.
  // Observations are options-independent, so one payload serves every copy of
  // that page; a Plan Story is defined by its options. Two of them in one deck
  // is a deck an advisor is actively invited to build — the `brief` preset is
  // "the short front-of-deck version … written to point at the pages after"
  // (`options-schema.ts`) and the palette permits duplicates — and the second
  // one carries a different scenario, a different `documentRole`, and a
  // different storage scope. Sharing the first one's payload would print the
  // wrong subtitle, narrate the wrong role, and read chapter text from the
  // wrong scope, all at the right page count. Silent, which is the failure mode
  // that matters.
  //
  // 🚨 Keyed on the PAGE being in the deck, not on the load succeeding, and
  // deliberately without a catch — `Promise.all` rejects if ANY entry's load
  // does, so no entry can quietly end up undefined. `document.tsx` reserves
  // each Plan Story page's sheets from `estimatePageCount`, which reads the
  // options alone and cannot see whether the story loaded — up to three. An
  // undefined `planStory` renders ONE, and the deck's table of contents takes
  // every start page from that same estimate, so a silently-absent story prints
  // a contents page pointing at the wrong sheet for everything after it. A
  // failed export is recoverable; a quietly mis-numbered one is handed to a
  // client, so a load failure fails the export.
  // (`plan-story/__tests__/view-model.test.ts` pins the 1-vs-3 gap.)
  const planStoryByPage = await Promise.all(
    body.pages.map(async (p) => {
      if (p.pageId !== "planStory") return undefined;
      // Already parsed and defaulted against `planStoryOptionsSchema` by
      // `pageDescriptorSchema` above — read through, never re-defaulted.
      const opts = p.options as PlanStoryOptions;
      return loadPlanStoryInput(clientId, firmId, {
        // The WHOLE options object, not a hand-picked subset: the loader reads
        // `sections` too, to skip the facts this deck's chapters will not print.
        ...opts,
        // The scenario's display NAME — a name a client can read under "Your
        // Plan". Resolved here rather than in the loader so the loader cannot
        // invent one, and NOT from `scenarioNames` above, which is built from
        // the deck's refs and never holds the story's own scenario. See
        // `story/scenario-label.ts`.
        scenarioLabel: await loadStoryScenarioLabel(clientId, opts.scenarioId),
      });
    }),
  );

  // One proposal per PAGE entry, not per deck: two Investment Proposal pages in
  // one deck may print different proposals. A deleted proposal resolves to
  // undefined and the page prints its empty state rather than taking the deck
  // down — a saved deck outlives the proposals it points at. Safe to resolve to
  // undefined here (unlike Plan Story above, where a failed load fails the
  // export) because the renderer prints one empty-state sheet PER RESERVED
  // SECTION when a picked proposal is gone, so the sheet count still equals
  // `estimateInvestmentProposalPageCount` and no start page shifts.
  const proposalByPage = await Promise.all(
    body.pages.map(async (p) => {
      if (p.pageId !== "investmentProposal") return undefined;
      // Already parsed and defaulted against `investmentProposalOptionsSchema`
      // by `pageDescriptorSchema` above — read through, never re-defaulted.
      const opts = p.options as InvestmentProposalOptions;
      return (await loadInvestmentProposalBundle(clientId, opts.proposalId)) ?? undefined;
    }),
  );

  // Life Insurance Summary: solve server-side from the compute cache, mirroring
  // the (now-removed) client-side pre-solve. For each LI page on a *live*
  // scenario we build the LiAssumptions from the page options + scenario and
  // call getOrComputeLifeInsuranceSolve, then inject the result into the page's
  // options.solved (replacing any client-sent value — we never trust that).
  // Snapshot refs can't be re-solved against a live seed, so they keep whatever
  // `solved` the client sent (matching the old launcher's snapshot fallback,
  // which skipped solving and left the saved/null value in place).
  if (needsLifeInsurance) {
    // modelPortfolioId → display label, exactly as the launcher derived it from
    // the investment catalog (fallback "Plan default rate"). Shares the
    // request-memoized catalog with the reinvestment enrichment above.
    const catalog = await getInvestmentCatalog();
    const portfolioLabelById = new Map(
      catalog.portfolios.map((p) => [p.id, p.name] as const),
    );
    // Dedupe solves per distinct scenario key (one solve covers every LI page
    // pointing at the same scenario), mirroring the launcher's solvedByScenario.
    const liSolvedByKey = new Map<string, LiSolved>();

    await Promise.all(
      body.pages.map(async (page, idx) => {
        if (page.pageId !== "lifeInsuranceSummary") return;
        const key = plan.pageKeys[idx];
        const ref = plan.distinct.get(key)?.ref;
        // Snapshot (or unresolved) ref: leave the client-sent solved untouched.
        if (!ref || ref.kind !== "scenario") return;

        if (!liSolvedByKey.has(key)) {
          const opts = page.options as LifeInsuranceSummaryOptions;
          const assumptions: LiAssumptions = {
            deathYear: opts.deathYear,
            modelPortfolioId: opts.modelPortfolioId,
            leaveToHeirsAmount: opts.leaveToHeirsAmount,
            livingExpenseAtDeath: opts.livingExpenseAtDeath,
            payoffLiabilityIds: opts.payoffLiabilityIds,
            mcTargetScore: opts.mcTargetScore,
            coverEstateTaxes: opts.coverEstateTaxes,
            scenarioRef: ref.id === "base" ? "base" : ref.id,
          };
          const modelPortfolioLabel = opts.modelPortfolioId
            ? (portfolioLabelById.get(opts.modelPortfolioId) ?? "Plan default rate")
            : "Plan default rate";
          try {
            const solved = await getOrComputeLifeInsuranceSolve({
              clientId: clientId,
              firmId,
              scenarioId: ref.id,
              assumptions,
              modelPortfolioLabel,
            });
            liSolvedByKey.set(key, solved);
          } catch (liErr) {
            // Non-fatal: leave solved unset so the page renders its
            // "not solved" frame instead of failing the whole export.
            console.error("LI solve failed for export", liErr);
          }
        }

        const solved = liSolvedByKey.get(key) ?? null;
        page.options = {
          ...(page.options as Record<string, unknown>),
          solved,
        } as typeof page.options;
      }),
    );
  }

  // Branding for the cover: resolved by the client's OWN advisor (an advisor
  // override wins field-by-field over the firm's branding; no override falls
  // through to the firm, identical to today). Resolved here — via a narrow
  // select scoped by BOTH clientId and firmId, never clientId alone — rather
  // than threaded through as a 4th parameter, so all five renderPresentationPdf
  // callers stay unchanged; this function already touches the DB for
  // client/projection data. Falls back to firm branding if the row is
  // somehow missing — branding must never be the thing that fails an export
  // (the ClientNotFoundError path above already owns "no such client").
  const [clientRow] = await db
    .select({ advisorId: clients.advisorId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  const branding = clientRow
    ? await resolveBrandingForClient(firmId, clientRow.advisorId)
    : await resolveBranding(firmId);
  const firmName = branding.firmName;
  const firmLogoDataUrl = branding.logoDataUrl ?? (await foundryDefaultLogoDataUrl());

  // Plan variants a page asked for: the base plan with one lever moved. Built
  // last, so every loaded bundle (including the max-spend attachments above) is
  // final, and so this work sits outside the scenario caps enforced up top.
  // Index-aligned with `body.pages` — and so with the document's `pages` prop
  // below, which is built from the same array — because the bundle keys are
  // per deck entry, not per page id.
  const bundlesWithDerived = resolveDerivedBundles(
    body.pages.map((p) => ({
      pageId: p.pageId,
      options: p.options,
      requiredDerivedRefs: PRESENTATION_PAGES[p.pageId].requiredDerivedRefs,
    })),
    bundles,
  );

  // Cast required: renderToBuffer expects ReactElement<DocumentProps> but
  // createElement infers ReactElement<PresentationDocumentProps>. The element
  // is valid at runtime — PresentationDocument wraps react-pdf's <Document>.
  const doc = React.createElement(PresentationDocument, {
    pages: body.pages.map((p, idx) => ({
      pageId: p.pageId,
      options: p.options as unknown as Record<string, unknown>,
      scenarioKey: plan.pageKeys[idx],
      planStory: planStoryByPage[idx],
      proposal: proposalByPage[idx],
    })),
    firmName,
    firmTagline: null,
    firmLogoDataUrl,
    accentColor: branding.primaryColor,
    clientName: clientFullName,
    reportDate: dateLong(new Date()),
    spouseName: spouseFirstName,
    spouseLastName,
    headerName,
    bundles: bundlesWithDerived,
    topScenarioKey: plan.topKey,
    investments,
    lifeInsurance,
    observations,
  }) as unknown as React.ReactElement<DocumentProps>;

  const buffer = await Promise.race<Buffer>([
    renderToBuffer(doc),
    new Promise<Buffer>((_, reject) =>
      setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
    ),
  ]);

  const filename = body.filename
    ? body.filename
    : `${slugify(clientLastName) || "client"}-presentation.pdf`;

  return { buffer, filename, clientLastName, distinctScenarioCount: plan.distinct.size };
}
