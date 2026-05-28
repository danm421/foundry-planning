import { describe, it, expect } from "vitest";
import { detectRothConversionEvents } from "../../detectors/roth-conversions";
import type { ProjectionYear } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

function mkProjection(rows: Partial<ProjectionYear>[]): ProjectionYear[] {
  return rows.map((r, i) => ({ year: 2030 + i, ...r } as ProjectionYear));
}

describe("detectRothConversionEvents", () => {
  it("emits one event per conversion per year it fires", () => {
    const data = buildClientData();
    const projection = mkProjection([
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 80000, taxable: 80000 }] },
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 95000, taxable: 95000 }] },
      { rothConversions: undefined },
      { rothConversions: [{ id: "rc-1", name: "Bracket ladder", gross: 110000, taxable: 110000 }] },
    ]);
    const events = detectRothConversionEvents(data, projection);
    const matches = events.filter((e) => e.id.startsWith("strategy:roth:rc-1:"));
    expect(matches.map((e) => e.year)).toEqual([2030, 2031, 2033]);
    expect(matches.every((e) => e.category === "strategy")).toBe(true);
    expect(matches[0].title).toBe("Bracket ladder");
    expect(matches[0].supportingFigure).toMatch(/\$80,000.*\$80,000/);
  });

  it("includes basis-aware % taxable in details when gross != taxable", () => {
    const data = buildClientData();
    const projection = mkProjection([
      { rothConversions: [{ id: "rc-2", name: "Backdoor", gross: 50000, taxable: 30000 }] },
    ]);
    const events = detectRothConversionEvents(data, projection);
    const ev = events[0];
    const pctRow = ev.details.find((d) => d.label.toLowerCase().includes("taxable"));
    expect(pctRow).toBeDefined();
  });

  it("emits one event per conversion when multiple conversions fire same year", () => {
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
    expect(events.find((e) => e.id === "strategy:roth:rc-a:2030")).toBeDefined();
    expect(events.find((e) => e.id === "strategy:roth:rc-b:2030")).toBeDefined();
  });
});
