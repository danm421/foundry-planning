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
