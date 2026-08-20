import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import type { TemplateDescriptor } from "./template-descriptor-schema";

/** Synthetic id prefix for built-ins surfaced to the client: `builtin:<slug>`. */
export const BUILTIN_ID_PREFIX = "builtin:";

export interface BuiltInTemplate {
  slug: string;
  name: string;
  pages: TemplateDescriptor[];
}

/**
 * Build a *portable* page descriptor. Start from the registry's defaultOptions
 * (always schema-valid and free of firm-specific references like portfolio
 * UUIDs or frozen calendar years) and layer only portable overrides on top.
 */
function page(
  pageId: PresentationPageId,
  overrides: Record<string, unknown> = {},
): TemplateDescriptor {
  return {
    pageId,
    options: {
      ...(PRESENTATION_PAGES[pageId].defaultOptions as Record<string, unknown>),
      ...overrides,
    },
  } as TemplateDescriptor;
}

export const BUILTIN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    slug: "foundation-plan",
    name: "Foundation Plan",
    pages: [
      page("cover", { title: "" }),
      page("toc"),
      page("clientProfile"),
      // asOf:"today" is portable; year/portfolio come from defaults (no frozen 2026).
      page("balanceSheet", { asOf: "today", includeOutOfEstate: false }),
      // default has no firm-specific portfolio reference (drops the captured UUID).
      page("assetAllocation"),
      page("retirementSummary"),
      page("taxSummary", { lowThreshold: 0.22, highThreshold: 0.24 }),
      // default solves per-client; captured deathYear:2045 was an arbitrary snapshot.
      page("lifeInsuranceSummary"),
      page("estateSummary", { ordering: "primaryFirst" }),
    ],
  },
  {
    slug: "comparison-plan",
    name: "Comparison Plan",
    pages: [
      page("cover", { title: "" }),
      page("toc"),
      page("clientProfile"),
      // asOf:"today" is portable; year/portfolio come from defaults (no frozen 2026).
      page("balanceSheet", { asOf: "today", includeOutOfEstate: false }),
      // What we changed, then what those changes bought. scenarioId stays ""
      // (portable) — the advisor picks the scenario inline in the launcher.
      page("scenarioChanges"),
      page("retirementComparison"),
      page("taxComparison"),
    ],
  },
  {
    slug: "cash-flow-details",
    name: "Cash Flow Details",
    pages: [
      page("cover", { title: "" }),
      page("toc"),
      page("cashFlow", { range: "full", showCallout: true }),
      page("cashFlowExpenses", { range: "full", showCallout: true }),
      page("cashFlowIncome", { range: "full", showCallout: true }),
      page("cashFlowNet", { range: "full", showCallout: true }),
      page("cashFlowAssets", { range: "full", showCallout: true }),
    ],
  },
  {
    slug: "your-early-years",
    name: "Your Early Years",
    pages: [
      // The only built-in that names itself on the cover: this deck answers one
      // narrow question rather than presenting the whole plan, so the generic
      // "Financial Planning Report" kicker would undersell it.
      page("cover", { title: "Your Early Years" }),
      page("toc"),
      // Where they stand; why the pay matters more than the balance; then one
      // lever per sheet. Every page takes the registry defaults, so nothing here
      // freezes a rate or an amount a template picked — the ladder and the
      // cost-of-waiting page both work RELATIVE to what this client already
      // defers, and every tidbit slot stays empty for the advisor.
      page("earlyYearsStanding"),
      page("earlyYearsHumanCapital"),
      page("earlyYearsLadder"),
      page("earlyYearsWaiting"),
      page("earlyYearsRoth"),
      // Removes itself on a plan with no amortizing debt, so this is "up to"
      // eight sheets, not exactly eight.
      page("earlyYearsDebtOrInvest"),
      // `earlyYearsTidbits` is deliberately NOT here — the spec asks for a back
      // page the advisor adds on purpose.
    ],
  },
] as const;

export const BUILTIN_SLUGS: ReadonlySet<string> = new Set(
  BUILTIN_TEMPLATES.map((t) => t.slug),
);

/** Shape surfaced to the client — mirrors LoadedTemplate + built-in markers. */
export interface BuiltInTemplateRow {
  id: string; // `builtin:${slug}`
  name: string;
  visibility: "shared";
  createdByUserId: "system";
  builtIn: true;
  slug: string;
  pages: TemplateDescriptor[];
}

function toRow(t: BuiltInTemplate): BuiltInTemplateRow {
  return {
    id: `${BUILTIN_ID_PREFIX}${t.slug}`,
    name: t.name,
    visibility: "shared",
    createdByUserId: "system",
    builtIn: true,
    slug: t.slug,
    pages: t.pages,
  };
}

/** Partition built-ins into visible vs dismissed for a given user. */
export function partitionBuiltInRows(dismissedSlugs: ReadonlySet<string>): {
  builtIn: BuiltInTemplateRow[];
  builtInHidden: BuiltInTemplateRow[];
} {
  const builtIn: BuiltInTemplateRow[] = [];
  const builtInHidden: BuiltInTemplateRow[] = [];
  for (const t of BUILTIN_TEMPLATES) {
    (dismissedSlugs.has(t.slug) ? builtInHidden : builtIn).push(toRow(t));
  }
  return { builtIn, builtInHidden };
}
