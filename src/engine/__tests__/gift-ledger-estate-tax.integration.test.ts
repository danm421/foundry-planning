import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildMinimalEstateScenario } from "./_fixtures/estate";

describe("Prior taxable gifts flow into estate tax", () => {
  it("first-death tentativeTaxBase includes priorTaxableGifts[deceased]", () => {
    const baseline = runProjection(buildMinimalEstateScenario({ priorClient: 0 }));
    const withPrior = runProjection(buildMinimalEstateScenario({ priorClient: 5_000_000 }));

    const baselineFirst = baseline.find((y) => y.estateTax?.deathOrder === 1);
    const withPriorFirst = withPrior.find((y) => y.estateTax?.deathOrder === 1);
    expect(baselineFirst).toBeDefined();
    expect(withPriorFirst).toBeDefined();

    // tentativeTaxBase = taxableEstate + adjustedTaxableGifts. taxableEstate is identical
    // between the two runs, so the delta equals priorTaxableGifts.
    const delta =
      withPriorFirst!.estateTax!.tentativeTaxBase - baselineFirst!.estateTax!.tentativeTaxBase;
    expect(delta).toBeCloseTo(5_000_000, 2);
    expect(withPriorFirst!.estateTax!.adjustedTaxableGifts).toBeCloseTo(5_000_000, 2);
  });

  it("final-death tentativeTaxBase includes priorTaxableGifts[finalDeceased]", () => {
    // Final death = spouse (LE 95) in 2057. Spouse has $3M prior gifts.
    const baseline = runProjection(buildMinimalEstateScenario({ priorClient: 0 }));
    const withSpousePrior = runProjection(
      buildMinimalEstateScenario({ priorClient: 0, priorSpouse: 3_000_000 }),
    );

    const baselineFinal = baseline.find((y) => y.estateTax?.deathOrder === 2);
    const withFinal = withSpousePrior.find((y) => y.estateTax?.deathOrder === 2);
    expect(baselineFinal).toBeDefined();
    expect(withFinal).toBeDefined();

    const delta =
      withFinal!.estateTax!.tentativeTaxBase - baselineFinal!.estateTax!.tentativeTaxBase;
    expect(delta).toBeCloseTo(3_000_000, 2);
  });
});
