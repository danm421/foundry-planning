// src/components/presentations/pages/scenario-changes/estimate-page-count.test.tsx
//
// The Contents page numbers every later sheet from estimatePageCount, so an
// estimator that is off by one silently mislabels the rest of the deck. This
// test pins the estimator against what react-pdf actually lays out — the only
// authority on how many sheets a table of N change rows takes.
//
// It lives beside the component, not beside the estimator, because it has to
// RENDER to answer.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";
import { ScenarioChangesPagePdf } from "./page-pdf";
import { estimateScenarioChangesPageCount } from "@/lib/presentations/pages/scenario-changes/estimate-page-count";
import type {
  ScenarioChangesPageData,
  DisplayUnit,
  ChangeRow,
} from "@/lib/presentations/pages/scenario-changes/types";

function renderedPages(pdf: Buffer): number {
  const match = /\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no page-tree node in the rendered PDF");
  return Number(match[1]);
}

function changeRow(i: number, detailLines: number): ChangeRow {
  return {
    area: "Income",
    what: `Change ${i + 1}`,
    op: "edit",
    before: "$100,000",
    after: "$120,000",
    detail: Array.from({ length: detailLines }, (_, d) => `Detail line ${d + 1} for change ${i + 1}`),
  };
}

function row(i: number, detailLines: number): DisplayUnit {
  return { kind: "row", row: changeRow(i, detailLines) };
}

function deck(units: DisplayUnit[], showExplanations = true): ScenarioChangesPageData {
  return {
    title: "Plan Comparison",
    subtitle: "Base Case vs. Proposed Plan",
    units,
    showExplanations,
    isEmpty: false,
  };
}

async function actualSheets(data: ScenarioChangesPageData): Promise<number> {
  ensureFontsRegistered();
  return renderedPages(
    await renderToBuffer(
      <Document>
        {ScenarioChangesPagePdf({
          data,
          firmName: "Ethos Financial Group",
          clientName: "Rachel Sheskier",
          reportDate: "August 31, 2026",
          pageIndex: 9,
          totalPages: 12,
          accent: DEFAULT_ACCENT,
        })}
      </Document>,
    ),
  );
}

describe("estimateScenarioChangesPageCount", () => {
  // Both sides of every sheet boundary measured for one, two and three detail
  // lines — the shapes the describe-layer actually emits.
  const CASES: Array<{ rows: number; detail: number }> = [
    { rows: 1, detail: 1 },
    { rows: 18, detail: 1 },
    { rows: 19, detail: 1 },
    { rows: 39, detail: 1 },
    { rows: 40, detail: 1 },
    { rows: 17, detail: 2 },
    { rows: 18, detail: 2 },
    { rows: 38, detail: 2 },
    { rows: 39, detail: 2 },
    { rows: 16, detail: 3 },
    { rows: 37, detail: 3 },
    { rows: 58, detail: 3 },
    { rows: 59, detail: 3 },
  ];

  it.each(CASES)("matches the render for $rows rows of $detail detail line(s)", async ({ rows, detail }) => {
    const data = deck(Array.from({ length: rows }, (_, i) => row(i, detail)));
    expect(estimateScenarioChangesPageCount(data)).toBe(await actualSheets(data));
  });

  it("matches the render when the changes are clustered into strategy groups", async () => {
    const units: DisplayUnit[] = [
      { kind: "group", label: "Roth conversion ladder", rows: [changeRow(0, 2), changeRow(1, 2), changeRow(2, 2)] },
      ...Array.from({ length: 14 }, (_, i) => row(i + 3, 2)),
      { kind: "group", label: "Retire early", rows: [changeRow(20, 1), changeRow(21, 1)] },
    ];
    const data = deck(units);
    expect(estimateScenarioChangesPageCount(data)).toBe(await actualSheets(data));
  });

  it("claims one sheet for the empty state and for a data-free probe", async () => {
    const empty: ScenarioChangesPageData = {
      title: "Plan Comparison",
      subtitle: "",
      units: [],
      showExplanations: true,
      isEmpty: true,
      emptyReason: "unselected",
    };
    expect(estimateScenarioChangesPageCount(empty)).toBe(1);
    expect(await actualSheets(empty)).toBe(1);
    // document.tsx's registry contract allows a probe before data exists.
    expect(estimateScenarioChangesPageCount(undefined)).toBe(1);
  });
});
