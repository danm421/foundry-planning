import { Fragment } from "react";
import { Document } from "@react-pdf/renderer";
import { PRESENTATION_PAGES, type PresentationPageId } from "./registry";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { ensureFontsRegistered } from "./shared/fonts";
import type { TocSection } from "./pages/toc/page-pdf";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import type { ObservationsRowInput } from "@/lib/presentations/pages/observations-next-steps/view-model";
import type { PlanStoryContextInput } from "@/lib/presentations/pages/plan-story/view-model";
import type { InvestmentProposalBundle } from "@/lib/presentations/investment-proposal-bundle";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import { SECTION_ACCENTS, DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { derivedKey, entryDerivedKey } from "@/lib/presentations/derived-refs";
import type { MaxSpendResult } from "@/lib/solver/solve-max-spending";

export interface PageScenarioBundle {
  clientData: ClientData;
  projection: ProjectionResult;
  scenarioLabel: string;
  monteCarlo?: MonteCarloReportPayload | null;
  scenarioChanges?: ScenarioChangesContext;
  maxSpend?: MaxSpendResult | null;
}

interface PresentationDocumentProps {
  pages: Array<{
    pageId: PresentationPageId;
    options?: Record<string, unknown> | undefined;
    /** Key into `bundles` — which scenario this page renders. */
    scenarioKey: string;
    /** THIS entry's story context and advisor-reviewed chapter text, read from
     *  storage by the export. Per entry, not per page id: two Plan Story pages
     *  in one deck (an executive brief up front, the full story later) carry
     *  different options, so a shared payload would print the first one's story
     *  under the second one's page count. Absent, the page renders one sheet
     *  where `estimatePageCount` reserved up to three, which shifts every start
     *  page `documentSections` below hands the TOC — so the caller supplies one
     *  for every Plan Story entry, and a load that fails fails the export. */
    planStory?: PlanStoryContextInput;
    /** THIS entry's frozen proposal snapshot, read by the export. Per entry,
     *  not per page id: two Investment Proposal pages in one deck may print
     *  different proposals. Absent → the page prints its empty state, which
     *  still occupies every sheet `estimatePageCount` reserved. */
    proposal?: InvestmentProposalBundle;
  }>;
  firmName: string;
  firmTagline: string | null;
  /** Cover branding: cream-panel logo (firm logo or Foundry default) + accent color. */
  firmLogoDataUrl: string | null;
  accentColor: string;
  clientName: string;
  reportDate: string;
  spouseName: string | null;
  /** Spouse surname (from the CRM contact) — null when solo or unknown. Lets
   *  the cover + Client Profile page show the spouse's real last name. */
  spouseLastName: string | null;
  /** Compact household name for the running page header ("Alan & Teresa").
   *  Distinct from `clientName`, which stays the formal primary/household name
   *  used on the cover and disclaimer. */
  headerName: string;
  /** One bundle per distinct scenario in the deck, keyed by `keyForRef`. */
  bundles: Record<string, PageScenarioBundle>;
  /** Key of the top-level scenario; fallback for any unmatched page. */
  topScenarioKey: string;
  /** Present only when the deck includes an investment page; scenario-independent. */
  investments?: InvestmentsBundle;
  /** Present only when the deck includes the Life Insurance Summary page. */
  lifeInsurance?: LifeInsuranceInventory;
  /** Present only when the deck includes the Observations page. */
  observations?: ObservationsRowInput[];
}

export function PresentationDocument(props: PresentationDocumentProps) {
  ensureFontsRegistered();

  // `idx` is the entry's position in the SUBMITTED deck and is load-bearing:
  // `entryDerivedKey` folded it into every derived bundle the export stored, and
  // the React key needs it to keep two entries of one page apart. Suppression
  // happens after this map, so the index travels with the entry rather than
  // being re-derived from the filtered list.
  const resolved = props.pages.map((p, idx) => {
    const page = PRESENTATION_PAGES[p.pageId];
    const options = { ...page.defaultOptions, ...(p.options ?? {}) };
    const bundle = props.bundles[p.scenarioKey] ?? props.bundles[props.topScenarioKey];

    // Scenario refs keep the key the export stored them under.
    const scenarioEntries: [string, PageScenarioBundle | undefined][] =
      page.requiredScenarioRefs
        ? page
            .requiredScenarioRefs(options as never)
            .map((raw) => keyForRef(resolveScenarioRef(raw)))
            .map((key) => [key, props.bundles[key]])
        : [];
    // Derived variants are stored per DECK ENTRY (`entryDerivedKey`, which folds
    // in `idx`) so two entries of the same page can't share a slot, but each
    // page sees only its own slice — so re-key to the index-free
    // `derivedKey(pageId, key)` a view model can name without knowing where in
    // the deck it sits. Both sides call the same two helpers, so the read and
    // the write cannot drift apart.
    const derivedEntries: [string, PageScenarioBundle | undefined][] =
      page.requiredDerivedRefs
        ? page
            .requiredDerivedRefs(options as never)
            .map((req) => [
              derivedKey(p.pageId, req.key),
              props.bundles[entryDerivedKey(idx, p.pageId, req.key)],
            ])
        : [];
    // Stays `undefined` (not `{}`) for pages that declare neither kind of ref:
    // that is the exact shape those pages saw before derived refs existed, and
    // nothing requires an empty object. Both original consumers
    // (`tax-comparison` and `retirement-comparison` view models) read
    // `ctx.bundlesByRef ?? {}`, so the two are interchangeable to them.
    const bundlesByRef: Record<string, PageScenarioBundle> | undefined =
      page.requiredScenarioRefs || page.requiredDerivedRefs
        ? Object.fromEntries(
            [...scenarioEntries, ...derivedEntries].filter(([, b]) => b != null) as [
              string,
              PageScenarioBundle,
            ][],
          )
        : undefined;

    return {
      p,
      idx,
      page,
      options,
      bundle,
      bundlesByRef,
    };
  });

  // A sheet whose own facts cannot support it leaves the deck — BEFORE page
  // numbering, so the contents list and the total never mention it.
  const kept = resolved.filter(
    (e) =>
      !e.page.omitFromDeck ||
      !e.page.omitFromDeck(
        {
          clientData: e.bundle.clientData,
          projection: e.bundle.projection,
          bundles: e.bundlesByRef ?? {},
        },
        e.options as never,
      ),
  );
  // react-pdf throws on a Document with no Page. An advisor who assembled a deck
  // of nothing but self-suppressing sheets gets one of them back rather than a
  // failed export.
  // Build each kept page once, then give that exact model to both the estimator
  // and renderer. A data-driven count cannot run before its rows exist.
  const entries = (kept.length > 0 ? kept : resolved.slice(0, 1)).map((entry) => {
    const { p, page, options, bundle, bundlesByRef } = entry;
    const data = page.buildData(
      {
        years: bundle.projection.years,
        projection: bundle.projection,
        clientData: bundle.clientData,
        scenarioLabel: bundle.scenarioLabel,
        clientName: props.clientName,
        spouseName: props.spouseName,
        spouseLastName: props.spouseLastName,
        firmName: props.firmName,
        firmTagline: props.firmTagline,
        firmLogoDataUrl: props.firmLogoDataUrl,
        accentColor: props.accentColor,
        reportDate: props.reportDate,
        monteCarlo: bundle.monteCarlo ?? null,
        investments: props.investments,
        lifeInsurance: props.lifeInsurance,
        observations: props.observations,
        planStory: p.planStory,
        proposal: p.proposal,
        bundlesByRef,
      },
      options as never,
    );

    return {
      ...entry,
      data,
      pageCount: page.estimatePageCount(data as never, options as never),
    };
  });

  // Compute each page's starting page number based on document order.
  const startPages = entries.reduce<number[]>((acc, _entry, i) => {
    const prevStart = i === 0 ? 1 : acc[i - 1];
    const prevCount = i === 0 ? 0 : entries[i - 1].pageCount;
    acc.push(prevStart + prevCount);
    return acc;
  }, []);
  const totalPages = entries.reduce((sum, { pageCount }) => sum + pageCount, 0);

  // TOC sections list every other selected page (excluding TOC entries
  // themselves), in document order, with their resolved page numbers. A page
  // that prints several titled sheets contributes one entry per sheet — the
  // deck used to list "Retirement Summary" and leave the reader to discover
  // "Income, Spending & Funding" on the sheet after it.
  const documentSections: TocSection[] = entries.flatMap(({ page, data, options }, i) => {
    if (page.id === "toc") return [];
    const sheets = page.tocSections?.(data as never, options as never) ?? [
      { title: page.title, offset: 0 },
    ];
    return sheets.map((sheet) => ({
      title: sheet.title,
      startPage: startPages[i] + sheet.offset,
    }));
  });

  return (
    <Document>
      {entries.map(({ p, idx, page, data }, i) => {
        return (
          <Fragment key={p.pageId + idx}>
            {page.renderPdf({
              // `data` is the union of all page-data types; `renderPdf`'s param is the
              // intersection (contravariant method on a union of page defs). Same
              // `as never` escape hatch already used for buildData/estimatePageCount.
              data: data as never,
              firmName: props.firmName,
              // The running page header shows the compact household name (both
              // first names for a couple). The formal `clientName` is still
              // available to pages via `buildData` (cover, disclaimer, Client
              // Profile primary card).
              clientName: props.headerName,
              reportDate: props.reportDate,
              pageIndex: startPages[i],
              totalPages,
              documentSections,
              accent: SECTION_ACCENTS[page.category] ?? DEFAULT_ACCENT,
            })}
          </Fragment>
        );
      })}
    </Document>
  );
}
