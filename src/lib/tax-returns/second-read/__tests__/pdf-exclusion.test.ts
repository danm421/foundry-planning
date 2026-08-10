import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj } from "@/lib/tax-analysis/__tests__/fixtures";

/**
 * D14: the AI second read is EXCLUDED from the client-facing PDF.
 *
 * The exclusion is STRUCTURAL, not conditional. `export-pdf/route.ts` builds
 * its document from `buildAnalysisForFacts(...)` — facts in, `TaxAnalysis` out
 * — and never reads `tax_return_state`, where the second read is persisted.
 * There is therefore no runtime channel a second-read item could travel down,
 * and no behavioural test can observe an absence that has no channel.
 *
 * So this pins the structure instead, and every probe below carries a positive
 * control: a probe that can no longer fire would otherwise report the exclusion
 * as holding for entirely the wrong reason.
 */

const SECOND_READ_REF = /second[-_]?read/i;

const EXPORT_ROUTE = "src/app/api/clients/[id]/tax-returns/[taxYear]/export-pdf/route.ts";
const PDF_DOCUMENT = "src/components/tax-analysis-pdf/tax-analysis-pdf-document.tsx";
/** Positive control: the year GET route genuinely serves the second read. */
const KNOWN_CONSUMER = "src/app/api/clients/[id]/tax-returns/[taxYear]/route.ts";

function source(relPath: string): string {
  const text = readFileSync(join(process.cwd(), relPath), "utf8");
  // A path that silently resolved to nothing would make every "does not
  // mention" assertion below pass vacuously.
  expect(text.length).toBeGreaterThan(200);
  return text;
}

/** Every key name in an object graph, at any depth. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      deepKeys(child, out);
    }
  }
  return out;
}

describe("D14: the second read never reaches the tax-analysis PDF", () => {
  it("the probe fires on a file that DOES consume the second read", () => {
    // Without this, a renamed identifier would turn every exclusion assertion
    // below into a test that cannot fail.
    expect(SECOND_READ_REF.test(source(KNOWN_CONSUMER))).toBe(true);
  });

  it("the PDF export route never mentions the second read", () => {
    expect(SECOND_READ_REF.test(source(EXPORT_ROUTE))).toBe(false);
  });

  it("the PDF document component never mentions the second read", () => {
    expect(SECOND_READ_REF.test(source(PDF_DOCUMENT))).toBe(false);
  });

  it("the PDF export route builds its analysis from facts, not from the assembler that carries the second read", () => {
    const route = source(EXPORT_ROUTE);
    // `assembleTaxAnalysis` returns `{ ..., secondRead, secondReadStale }`.
    // Switching the PDF route onto it is the one refactor that would leak the
    // AI lane into a client-facing document — this is what catches it.
    expect(route).toContain("buildAnalysisForFacts");
    expect(route).not.toContain("assembleTaxAnalysis");
  });

  it("the analysis object the PDF renders from carries no second-read field at any depth", () => {
    // Probe control: the same scan finds the key when it IS present.
    expect(deepKeys({ a: { secondRead: [] } }).filter((k) => SECOND_READ_REF.test(k))).toEqual([
      "secondRead",
    ]);

    // `buildAnalysisForFacts` is `return buildTaxAnalysis({...})` verbatim, so
    // this is the exact object shape the PDF document receives as `analysis`.
    const resolver = createTaxResolver([params2025], {
      taxInflationRate: 0.025,
      ssWageGrowthRate: 0.03,
    });
    const analysis = buildTaxAnalysis({
      facts: retireeMfj(),
      prior: null,
      resolver,
      primaryAge: 72,
      spouseAge: 72,
    });

    expect(deepKeys(analysis).filter((k) => SECOND_READ_REF.test(k))).toEqual([]);
  });
});
