import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioSnapshots } from "@/db/schema";
import { resolveBranding } from "@/lib/branding/branding";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
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
import { getClientWithContacts } from "@/lib/clients/get-client-with-contacts";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import { getOrComputeLifeInsuranceSolve } from "@/lib/compute-cache/life-insurance";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import type {
  LifeInsuranceSummaryOptions,
  LiSolved,
} from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import {
  buildBaseResolveData,
  buildAssetTxResolveData,
  buildReinvestmentEnrichmentDeps,
  hasReinvestmentChange,
  applyReinvestmentEnrichment,
} from "@/lib/scenario/scenario-changes-resolve";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import {
  planScenarioBundles,
  labelForRef,
  keyForRef,
  resolveScenarioRef,
  type PlannerPage,
} from "@/lib/scenario/presentation-refs";
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

// Guardrails: cap the work a single export can fan out to, so a deck with
// many per-page scenario overrides can't blow the 25 s render / 60 s function
// budget. Exceeding either returns 400 instead of timing out.
const MAX_DISTINCT_SCENARIOS = 6;
const MAX_MC_SCENARIOS = 3;

// Pages that require a server-side Monte Carlo run for their scenario. The MC
// page renders the full simulation; the Retirement Summary needs it only for its
// Monte Carlo KPI. Runs are deduped per distinct scenario in planScenarioBundles.
const MONTE_CARLO_PAGE_IDS = new Set<string>(["monteCarlo", "retirementSummary", "retirementComparison"]);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
      needsMonteCarloRun: MONTE_CARLO_PAGE_IDS.has(p.pageId),
      // The comparison page also needs the chosen scenario's change set loaded.
      isScenarioChanges:
        p.pageId === "scenarioChanges" || p.pageId === "retirementComparison",
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

  // Resolve human-readable names for every live scenario / snapshot id in the
  // plan, in two batched queries. firmId scoping is enforced per-tree below by
  // loadEffectiveTreeForRef (it throws on a cross-org id before we use names).
  const liveScenarioIds: string[] = [];
  const snapshotIds: string[] = [];
  for (const { ref } of plan.distinct.values()) {
    if (ref.kind === "snapshot") snapshotIds.push(ref.id);
    else if (ref.id !== "base") liveScenarioIds.push(ref.id);
  }

  const scenarioNames = new Map<string, string>();
  if (liveScenarioIds.length > 0) {
    const rows = await db
      .select({ id: scenarios.id, name: scenarios.name })
      .from(scenarios)
      .where(inArray(scenarios.id, liveScenarioIds));
    for (const r of rows) scenarioNames.set(r.id, r.name);
  }
  if (snapshotIds.length > 0) {
    const rows = await db
      .select({ id: scenarioSnapshots.id, name: scenarioSnapshots.name })
      .from(scenarioSnapshots)
      .where(inArray(scenarioSnapshots.id, snapshotIds));
    for (const r of rows) scenarioNames.set(r.id, r.name);
  }
  // Conditionally load the investments bundle — only when the deck includes
  // at least one investment page, to avoid unnecessary DB queries.
  const needsInvestments = body.pages.some(
    (p) => p.pageId === "assetAllocation" || p.pageId === "portfolioAnalysis" || p.pageId === "assumptions",
  );
  const investments = needsInvestments
    ? (await loadInvestmentsBundle(clientId, firmId)) ?? undefined
    : undefined;

  // Memoize the firm's investment-option catalog across the request — both the
  // per-scenario reinvestment enrichment and the Life Insurance block below
  // consume it, and it's a multi-query bundle load. Lazily loaded on first use.
  let investmentCatalog: ReturnType<typeof listInvestmentOptionCatalog> | null = null;
  const getInvestmentCatalog = () =>
    (investmentCatalog ??= listInvestmentOptionCatalog(clientId, firmId));

  // Build one bundle per distinct scenario. Projection always; Monte Carlo
  // and scenario-changes only where the plan says a page needs them. The
  // distinct scenarios are independent and bounded by MAX_DISTINCT_SCENARIOS,
  // so build them concurrently (the LI block below already does the same).
  // A load failure surfaces as a sentinel result rather than rejecting the
  // batch, so we preserve the original first-error-wins 404/422 responses.
  type BundleResult =
    | { kind: "ok"; key: string; bundle: PageScenarioBundle }
    | { kind: "notFound" }
    | { kind: "invalidInput" };

  const bundleResults = await Promise.all(
    [...plan.distinct].map(async ([key, d]): Promise<BundleResult> => {
      let clientData;
      try {
        const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, d.ref);
        clientData = effectiveTree;
      } catch (err) {
        if (err instanceof ClientNotFoundError) {
          return { kind: "notFound" };
        }
        if (err instanceof ProjectionInputError) {
          // The raw message embeds internal client / CRM-household UUIDs (audit
          // F4). Keep the detail server-side; return a generic message.
          console.error(
            "POST /clients/[id]/presentations/export-pdf projection input error",
            err,
          );
          return { kind: "invalidInput" };
        }
        throw err;
      }

      const projection = runProjectionWithEvents(clientData);

      // Monte Carlo: served from the compute cache (or computed + stored on miss).
      // Snapshots have no live scenario row so they fall back to the base seed,
      // matching the old inline behaviour.
      let monteCarlo: MonteCarloReportPayload | null = null;
      if (d.needsMonteCarlo) {
        try {
          const cached = await getOrComputeMonteCarlo({
            clientId: clientId,
            firmId,
            scenarioId: d.ref.kind === "scenario" ? d.ref.id : "base",
          });
          monteCarlo = cached.payload;
        } catch (mcErr) {
          // Non-fatal: leave monteCarlo null so the page renders its graceful
          // "data unavailable" frame instead of failing the whole export.
          console.error("Monte Carlo cache fetch failed for export", mcErr);
        }
      }

      // Scenario Changes report: load the raw edits for the active scenario, but
      // only when the deck includes that page AND the active ref is a live
      // scenario (not base / snapshot). loadScenarioChanges returns enabled rows
      // only — matching what the overlaid clientData already reflects.
      //
      // Org-scoping note: loadScenarioChanges/loadScenarioToggleGroups read by
      // scenarioId alone. The scenarioId is proven to belong to this firm/client by
      // the earlier loadEffectiveTreeForRef() call (it loads the scenario scoped to
      // clientId/firmId and throws on a cross-org id before we reach here). Do not
      // remove or lazily defer that call without adding firm scoping to these reads.
      let scenarioChanges: ScenarioChangesContext | undefined;
      if (d.needsScenarioChanges && d.ref.kind === "scenario") {
        const scenarioId = d.ref.id;
        try {
          const [changes, toggleGroups] = await Promise.all([
            loadScenarioChanges(scenarioId),
            loadScenarioToggleGroups(scenarioId),
          ]);
          // Always build the base resolve maps (account / recipient / entity /
          // spouse names) off the effective tree — this is what makes
          // transfer / savings / roth / gift / will changes render rich
          // references instead of terse fallbacks.
          let resolve = buildBaseResolveData(clientData);

          // Reinvestment enrichment: surface the NEW model portfolio (name +
          // resolved growth rate) the switched accounts grow at. Names come
          // from the firm's investment-option catalog (memoized per request);
          // rates from the effective tree's already-resolved reinvestments.
          // Gated on a reinvestment change so the catalog query only loads when
          // it can matter.
          if (hasReinvestmentChange(changes)) {
            try {
              const catalog = await getInvestmentCatalog();
              const portfolioNamesById = Object.fromEntries(
                catalog.portfolios.map((p) => [p.id, p.name] as const),
              );
              resolve = applyReinvestmentEnrichment(
                resolve,
                buildReinvestmentEnrichmentDeps(changes, portfolioNamesById, clientData.reinvestments ?? []),
              );
            } catch (riErr) {
              // Non-fatal: the describer degrades to a blended-rate-only line.
              console.error("Reinvestment enrichment failed for export", riErr);
            }
          }

          // Asset-transaction enrichment: projection-derived value bought/sold
          // and net cash received, keyed by transaction id. Always safe — a
          // pure reshape of the already-computed projection breakdown.
          resolve = { ...resolve, assetTxById: buildAssetTxResolveData(projection.years) };

          scenarioChanges = {
            changes,
            toggleGroups,
            targetNames: buildTargetNames(clientData, clientId),
            baseLabel: "your current plan",
            resolve,
          };
        } catch (scErr) {
          // Non-fatal: leave undefined so the page renders its empty state.
          console.error("Scenario changes load failed for export", scErr);
        }
      }

      return {
        kind: "ok",
        key,
        bundle: {
          clientData,
          projection,
          scenarioLabel: labelForRef(d.ref, scenarioNames),
          monteCarlo,
          scenarioChanges,
        },
      };
    }),
  );

  // First-error-wins, matching the original serial loop's early returns.
  const firstErr = bundleResults.find((r) => r.kind !== "ok");
  if (firstErr?.kind === "notFound") {
    throw new ClientNotFoundError(clientId);
  }
  if (firstErr?.kind === "invalidInput") {
    throw new ProjectionInputError("Client data is incomplete or invalid for this projection.");
  }

  const bundles: Record<string, PageScenarioBundle> = {};
  for (const r of bundleResults) {
    if (r.kind === "ok") bundles[r.key] = r.bundle;
  }

  // Max sustainable spending: solve per (scenario, target) for each Retirement
  // Comparison page and attach to both the base and scenario bundles it reads.
  // Unlike the Life-Insurance pass below (whose solve is page-specific and is
  // injected into page.options), max-spend depends only on (scenario, target),
  // so it attaches to the shared bundle — one solve serves every RC page on it.
  // Cached (kind="max_spending") so repeated decks / the AI route are cheap.
  const maxSpendDone = new Set<string>(); // `${key}:${target}`
  await Promise.all(
    body.pages.flatMap((page) => {
      if (page.pageId !== "retirementComparison") return [];
      const opts = page.options as { scenarioId: string; maxSpend: { show: boolean; targetConfidence: number } };
      if (!opts.maxSpend.show) return [];
      const target = opts.maxSpend.targetConfidence;
      // The retirement comparison page always reads "base" plus the chosen
      // scenario. Resolve to the same keys planScenarioBundles registered so
      // we attach to the exact bundle objects the PDF renderer will read.
      const refs: Array<{ key: string; scenarioId: string | "base" }> = [
        { key: keyForRef(resolveScenarioRef("base")), scenarioId: "base" },
        ...(opts.scenarioId
          ? [{ key: keyForRef(resolveScenarioRef(opts.scenarioId)), scenarioId: opts.scenarioId }]
          : []),
      ];
      return refs.map(async ({ key, scenarioId }) => {
        const dedupe = `${key}:${target}`;
        if (maxSpendDone.has(dedupe) || !bundles[key]) return;
        maxSpendDone.add(dedupe);
        try {
          bundles[key].maxSpend = await getOrComputeMaxSpending({
            clientId: clientId, firmId, scenarioId, targetPoS: target,
          });
        } catch (msErr) {
          console.error("Max-spend solve failed for export", msErr);
          bundles[key].maxSpend = null; // page degrades to hidden block
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

  // Firm branding for the cover: name, accent color, and logo. Falls back to
  // the Foundry mark + gold when the firm hasn't set their own.
  const branding = await resolveBranding(firmId);
  const firmName = branding.firmName;
  const firmLogoDataUrl = branding.logoDataUrl ?? (await foundryDefaultLogoDataUrl());

  // Cast required: renderToBuffer expects ReactElement<DocumentProps> but
  // createElement infers ReactElement<PresentationDocumentProps>. The element
  // is valid at runtime — PresentationDocument wraps react-pdf's <Document>.
  const doc = React.createElement(PresentationDocument, {
    pages: body.pages.map((p, idx) => ({
      pageId: p.pageId,
      options: p.options as unknown as Record<string, unknown>,
      scenarioKey: plan.pageKeys[idx],
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
    bundles,
    topScenarioKey: plan.topKey,
    investments,
    lifeInsurance,
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
