import type { CellV5, ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { CoverProps } from "./build-cover";

export const PAGE_AREA_PT = 624;

const TALL_NATIVE_KINDS = new Set([
  "client-profile",
  "scenario-changes",
]);

const TABLE_NATIVE_KINDS = new Set([
  "year-by-year",
  "rmd-schedule",
  "decade-summary",
  "roth-ladder",
  "balance-sheet",
  "expense-detail",
  "gift-tax",
  "estate-end-beneficiaries",
  "estate-transfers-yearly",
  "major-transactions",
]);

const CHART_SNAPSHOT_KINDS = new Set([
  "portfolio",
  "monte-carlo",
  "longevity",
  "lifetime-tax",
  "liquidity",
  "estate-impact",
  "estate-tax",
  "income-expense",
  "withdrawal-source",
  "ss-income",
  "allocation-drift",
  "tax-bracket-fill",
  "charitable-impact",
  "cash-flow-gap",
  "success-gauge",
  "income-sources",
  "asset-allocation",
]);

export function estimateCellHeight({ kind, span }: { kind: string; span: 1 | 2 | 3 | 4 | 5 }): number {
  if (TALL_NATIVE_KINDS.has(kind)) return 220;
  if (TABLE_NATIVE_KINDS.has(kind)) return 360;
  if (CHART_SNAPSHOT_KINDS.has(kind)) return span >= 3 ? 360 : 280;
  // kpi / kpi-strip / text / unknown small widgets
  return 120;
}

export type ComparisonPdfPage =
  | { kind: "cover"; props: CoverProps }
  | { kind: "group"; groupId: string; cells: CellV5[]; continued: boolean };

export function paginate(layout: ComparisonLayoutV5, cover: CoverProps): ComparisonPdfPage[] {
  const pages: ComparisonPdfPage[] = [{ kind: "cover", props: cover }];

  for (const group of layout.groups) {
    const cells = group.cells.filter((c) => c.widget !== null);
    if (cells.length === 0) continue;

    let current: CellV5[] = [];
    let usedHeight = 0;
    let continued = false;

    for (const c of cells) {
      const h = estimateCellHeight({ kind: c.widget!.kind, span: c.span });
      if (current.length > 0 && usedHeight + h > PAGE_AREA_PT) {
        pages.push({ kind: "group", groupId: group.id, cells: current, continued });
        current = [];
        usedHeight = 0;
        continued = true;
      }
      current.push(c);
      usedHeight += h;
    }
    if (current.length > 0) {
      pages.push({ kind: "group", groupId: group.id, cells: current, continued });
    }
  }

  return pages;
}
