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
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import { SECTION_ACCENTS, DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
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

  // Resolve per-page options + estimated page counts.
  const resolved = props.pages.map((p) => {
    const page = PRESENTATION_PAGES[p.pageId];
    const options = { ...page.defaultOptions, ...(p.options ?? {}) };
    const pageCount = page.estimatePageCount(undefined as never, options as never);
    return { p, page, options, pageCount };
  });

  // Compute each page's starting page number based on document order.
  const startPages = resolved.reduce<number[]>((acc, _entry, idx) => {
    const prevStart = idx === 0 ? 1 : acc[idx - 1];
    const prevCount = idx === 0 ? 0 : resolved[idx - 1].pageCount;
    acc.push(prevStart + prevCount);
    return acc;
  }, []);
  const totalPages = resolved.reduce((sum, { pageCount }) => sum + pageCount, 0);

  // TOC sections list every other selected page (excluding TOC entries
  // themselves), in document order, with their resolved page numbers.
  const documentSections: TocSection[] = resolved
    .map(({ page }, idx) => ({ title: page.title, startPage: startPages[idx], id: page.id }))
    .filter((s) => s.id !== "toc")
    .map(({ title, startPage }) => ({ title, startPage }));

  return (
    <Document>
      {resolved.map(({ p, page, options }, idx) => {
        const bundle =
          props.bundles[p.scenarioKey] ?? props.bundles[props.topScenarioKey];
        const bundlesByRef: Record<string, PageScenarioBundle> | undefined =
          page.requiredScenarioRefs
            ? Object.fromEntries(
                page
                  .requiredScenarioRefs(options as never)
                  .map((raw) => keyForRef(resolveScenarioRef(raw)))
                  .map((key) => [key, props.bundles[key]])
                  .filter(([, b]) => b != null) as [string, PageScenarioBundle][],
              )
            : undefined;
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
            scenarioChanges: bundle.scenarioChanges,
            bundlesByRef,
          },
          options as never,
        );
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
              pageIndex: startPages[idx],
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
