import { describe, it, expect, beforeAll } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/pdf/fonts";
import { FanChartPdf } from "../fan-pdf";
import { HistogramPdf } from "../histogram-pdf";
import { SuccessPdf } from "../success-pdf";
import {
  buildFanChartSpec,
  buildHistogramChartSpec,
  buildSuccessChartSpec,
} from "@/lib/presentations/charts/monte-carlo-specs";

const byYear = [
  { year: 2026, age: { client: 65 }, balance: { p5: 90, p20: 280, p50: 560, p80: 840, p95: 1100, min: 0, max: 1200 }, cagrFromStart: null },
  { year: 2027, age: { client: 66 }, balance: { p5: 80, p20: 260, p50: 540, p80: 820, p95: 1080, min: 0, max: 1180 }, cagrFromStart: null },
];

const histogram = {
  bins: [{ min: 0, max: 500, count: 200 }, { min: 500, max: 1000, count: 600 }],
  p5: 100, p25: 400, p50: 600, p75: 850, p95: 1200,
  belowDomainCount: 0, aboveDomainCount: 0,
  sd: { mean: 620, stdDev: 250, minus2: 120, minus1: 370, plus1: 870, plus2: 1120, countWithin1: 700, countWithin2: 950, countBelowMinus2: 10, countAbovePlus2: 40 },
};

async function renders(node: React.ReactElement) {
  const buf = await renderToBuffer(<Document><Page>{node}</Page></Document>);
  expect(buf.length).toBeGreaterThan(0);
}

beforeAll(() => ensureFontsRegistered());

describe("monte carlo chart renderers", () => {
  it("renders the fan chart (hero + thumb)", async () => {
    const spec = buildFanChartSpec({ byYear, deterministic: [555, 545], markers: [] });
    await renders(<FanChartPdf spec={spec} />);
    await renders(<FanChartPdf spec={spec} scale={0.5} />);
  });
  it("renders the histogram", async () => {
    await renders(<HistogramPdf spec={buildHistogramChartSpec(histogram)} />);
  });
  it("renders the success chart", async () => {
    const spec = buildSuccessChartSpec({ successRates: [0.95, 0.6], years: [2026, 2027], ages: [65, 66] });
    await renders(<SuccessPdf spec={spec} />);
  });
});
