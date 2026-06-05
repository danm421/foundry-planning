import { describe, it, expect } from "vitest";
import { detectRothConversionEvents } from "../../detectors/roth-conversions";
import type { ProjectionYear } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

function mkProjection(rows: Partial<ProjectionYear>[]): ProjectionYear[] {
  return rows.map((r, i) => ({ year: 2030 + i, ...r } as ProjectionYear));
}

describe("detectRothConversionEvents", () => {
  it("consolidates every fire year into a single card per conversion", () => {
    const data = buildClientData();
    const projection = mkProjection([
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 80000, taxable: 80000 }] },
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 95000, taxable: 95000 }] },
      { rothConversions: undefined },
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 110000, taxable: 110000 }] },
    ]);
    const events = detectRothConversionEvents(data, projection);
    const matches = events.filter((e) => e.id.startsWith("strategy:roth:rc-1"));

    // One card for the whole conversion, anchored at the first fire year.
    expect(matches).toHaveLength(1);
    const card = matches[0];
    expect(card.id).toBe("strategy:roth:rc-1");
    expect(card.year).toBe(2030);
    expect(card.category).toBe("strategy");
    expect(card.title).toBe("Bracket ladder");

    // Each fire year appears as its own detail row (year → amount).
    const yearRows = card.details.filter((d) => /^\d{4}$/.test(d.label));
    expect(yearRows.map((d) => d.label)).toEqual(["2030", "2031", "2033"]);
    expect(yearRows.map((d) => d.value)).toEqual(["$80,000", "$95,000", "$110,000"]);

    // Supporting figure summarizes the total across all years.
    expect(card.supportingFigure).toContain("$285,000");
    expect(card.supportingFigure).toContain("3 years");
  });

  it("surfaces the per-year taxable amount when gross != taxable", () => {
    const data = buildClientData();
    const projection = mkProjection([
      { rothConversions: [{ id: "rc-2", name: "Backdoor", gross: 50000, taxable: 30000 }] },
    ]);
    const events = detectRothConversionEvents(data, projection);
    const card = events.find((e) => e.id === "strategy:roth:rc-2");
    expect(card).toBeDefined();
    const row2030 = card!.details.find((d) => d.label === "2030");
    expect(row2030?.value).toBe("$50,000 · $30,000 taxable");
  });

  it("emits one card per conversion when multiple conversions fire the same year", () => {
    const data = buildClientData();
    const projection = mkProjection([
      {
        rothConversions: [
          { id: "rc-a", name: "Plan A", gross: 50000, taxable: 50000 },
          { id: "rc-b", name: "Plan B", gross: 25000, taxable: 25000 },
        ],
      },
    ]);
    const events = detectRothConversionEvents(data, projection);
    expect(events.find((e) => e.id === "strategy:roth:rc-a")).toBeDefined();
    expect(events.find((e) => e.id === "strategy:roth:rc-b")).toBeDefined();
  });
});
