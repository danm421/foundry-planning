import { describe, it, expect } from "vitest";
import { chartCitationGate } from "../chart-citation";
import { moneyFact } from "../../facts";

const chartFact = moneyFact("chart.portfolio.peak", "The most the plan ever holds", 2_100_000);
const plainFact = moneyFact("today.assets", "What you own", 850_000);

describe("chartCitationGate", () => {
  it("fails prose that names no figure from its chart", () => {
    const failures = chartCitationGate("You own $850K today, and the plan holds up.", [
      chartFact,
      plainFact,
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.gate).toBe("chartCitation");
  });

  it("passes prose that names one of the chart's own figures", () => {
    const failures = chartCitationGate("The plan peaks at $2.1M before it turns down.", [
      chartFact,
      plainFact,
    ]);
    expect(failures).toEqual([]);
  });

  it("is SILENT on a chapter whose facts hold no chart at all", () => {
    // The no-data path: the chart was dropped for want of data, so there is
    // nothing to cite and demanding a citation would fail every draft.
    const failures = chartCitationGate("You own $850K today.", [plainFact]);
    expect(failures).toEqual([]);
  });

  it("accepts the figure however the model dressed it up", () => {
    // Same normalisation Gate 1 uses — bolding a key number is exactly what a
    // report-writing model does.
    const failures = chartCitationGate("The plan peaks at $**2.1M**.", [chartFact]);
    expect(failures).toEqual([]);
  });

  it("does not accept a DIFFERENT figure that merely contains the chart's digits", () => {
    const failures = chartCitationGate("The plan peaks at $12.1M.", [chartFact]);
    expect(failures).toHaveLength(1);
  });
});
