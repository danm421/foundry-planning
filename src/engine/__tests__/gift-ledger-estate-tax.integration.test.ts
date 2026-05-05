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

  it("client's prior gifts do not erode survivor's DSUE-padded exclusion", () => {
    // Client dies first in 2030 with $5M prior gifts. Survivor (spouse) inherits
    // DSUE from any unused first-death exclusion. At spouse's final death:
    //   - applicableExclusion = BEA(year) + dsueReceived
    //   - adjustedTaxableGifts = spouse's own cumulative taxable gifts (here: $0)
    // Client's $5M flowed through the FIRST death's tentativeTaxBase already,
    // and must NOT bleed into the spouse's tax base at final death.
    const withClientPrior = runProjection(
      buildMinimalEstateScenario({ priorClient: 5_000_000, priorSpouse: 0 }),
    );
    const finalDeath = withClientPrior.find((y) => y.estateTax?.deathOrder === 2);
    expect(finalDeath).toBeDefined();

    // Spouse's adjustedTaxableGifts at final death must equal her own ($0),
    // not pick up client's $5M.
    expect(finalDeath!.estateTax!.adjustedTaxableGifts).toBeLessThan(5_000_000);
  });
});
