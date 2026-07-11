// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BracketMapBars } from "../bracket-map-bars";
import { buildBracketMap } from "@/lib/tax-analysis/bracket-map";
import { params2025, retireeMfj } from "@/lib/tax-analysis/__tests__/fixtures";

describe("BracketMapBars", () => {
  it("renders a sane empty ordinary bar (no NaN) when preferential income consumes all taxable income", () => {
    // Deductions eat the ordinary portion entirely: TI $30,000 < preferential
    // income (LTCG $50,000 + qualified dividends $0) → ordinary.taxBase clamps
    // to 0 (Math.max(0, ti - preferentialBase)). Before the fix, scaleTop was
    // Math.max(taxBase*1.25, visible[last].from) = Math.max(0, 0) = 0, and the
    // per-segment width divided by that zero → NaN.
    const f = retireeMfj();
    f.deductions.taxableIncome = 30000;
    f.income.netLongTermGain = 50000;
    f.income.netShortTermGain = 0;
    f.income.qualifiedDividends = 0;
    const map = buildBracketMap(f, params2025)!;
    expect(map.ordinary.taxBase).toBe(0);

    const { container } = render(<BracketMapBars map={map} />);
    const bracketMap = screen.getByTestId("bracket-map");
    expect(bracketMap).toBeTruthy();
    expect(container.innerHTML).not.toContain("NaN");

    // jsdom (like real browsers) silently discards an inline style whose value
    // is an invalid CSS length (e.g. "NaN%") rather than rendering the literal
    // string "NaN" — so the segment wrapper's `style="width: …"` attribute is
    // present with a real value only when scaleTop is positive; pre-fix, the
    // whole `style` attribute is missing because "NaN%" never parses.
    const segmentDiv = bracketMap.querySelector(".border-r.border-hair") as HTMLElement | null;
    expect(segmentDiv).toBeTruthy();
    expect(segmentDiv?.getAttribute("style")).toMatch(/width:\s*\d/);
  });
});
