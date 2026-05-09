// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EstateTaxComparisonTable } from "../estate-tax-comparison-table";
import type { ProjectionResult } from "@/engine/projection";

interface DeathFixture {
  year: number;
  federalEstateTax: number;
  stateEstateTax?: number;
  estateAdminExpenses?: number;
  ird?: number;
}

function mkResult(first?: DeathFixture, second?: DeathFixture): ProjectionResult {
  const buildEvent = (e?: DeathFixture) => {
    if (!e) return undefined;
    const federal = e.federalEstateTax;
    const state = e.stateEstateTax ?? 0;
    const admin = e.estateAdminExpenses ?? 0;
    const ird = e.ird ?? 0;
    return {
      year: e.year,
      federalEstateTax: federal,
      stateEstateTax: state,
      estateAdminExpenses: admin,
      totalTaxesAndExpenses: federal + state + admin,
      drainAttributions: ird > 0
        ? [{ drainKind: "ird_tax", amount: ird, recipient: "any", recipientName: "any" }]
        : [],
    };
  };
  return {
    firstDeathEvent: buildEvent(first),
    secondDeathEvent: buildEvent(second),
  } as unknown as ProjectionResult;
}

describe("EstateTaxComparisonTable", () => {
  it("renders federal/state/admin/IRD line items per death and a combined subtotal", () => {
    const { container } = render(
      <EstateTaxComparisonTable
        plan1Result={mkResult(
          { year: 2050, federalEstateTax: 0, stateEstateTax: 0, estateAdminExpenses: 0 },
          { year: 2055, federalEstateTax: 49000000, stateEstateTax: 612900, estateAdminExpenses: 3292087, ird: 200000 },
        )}
        plan2Result={mkResult(
          { year: 2050, federalEstateTax: 0, stateEstateTax: 0, estateAdminExpenses: 0 },
          { year: 2055, federalEstateTax: 32000000, stateEstateTax: 225344, estateAdminExpenses: 2197130, ird: 100000 },
        )}
        plan1Label="Base"
        plan2Label="Aggressive"
      />,
    );
    expect(container.textContent).toContain("Base");
    expect(container.textContent).toContain("Aggressive");
    // Federal estate tax for second-death plan 1: $49,000,000
    expect(container.textContent).toContain("$49,000,000");
    // State estate tax (hide-if-zero kicks in only when both are zero — these are non-zero)
    expect(container.textContent).toContain("$612,900");
    // IRD line item should show
    expect(container.textContent).toContain("Tax on Income with Respect to Decedent (IRD)");
    expect(container.textContent).toContain("$200,000");
    // Combined: plan 1 second-death total = 49,000,000 + 612,900 + 3,292,087 + 200,000 = $53,104,987
    //          plan 2 second-death total = 32,000,000 + 225,344 + 2,197,130 + 100,000 = $34,522,474
    //          delta = $34,522,474 − $53,104,987 = −$18,582,513
    expect(container.textContent).toContain("$53,104,987");
    expect(container.textContent).toContain("$34,522,474");
    expect(container.textContent).toContain("−$18,582,513");
  });

  it("hides State / Probate / IRD rows when both plans show zero on that line", () => {
    // First death has no state, no probate, no IRD on either plan — those rows should not render.
    const { container } = render(
      <EstateTaxComparisonTable
        plan1Result={mkResult(
          { year: 2050, federalEstateTax: 100000 }, // no state, no admin, no IRD
          { year: 2055, federalEstateTax: 200000 },
        )}
        plan2Result={mkResult(
          { year: 2050, federalEstateTax: 90000 },
          { year: 2055, federalEstateTax: 180000 },
        )}
        plan1Label="A"
        plan2Label="B"
      />,
    );
    expect(container.textContent).toContain("Federal Estate Tax");
    expect(container.textContent).not.toContain("State Estate Tax");
    expect(container.textContent).not.toContain("Probate & Final Expenses");
    expect(container.textContent).not.toContain("Tax on Income with Respect to Decedent");
  });

  it("renders a Combined Total row even when only one plan has death events", () => {
    const { container } = render(
      <EstateTaxComparisonTable
        plan1Result={mkResult(undefined, undefined)}
        plan2Result={mkResult(undefined, { year: 2055, federalEstateTax: 100 })}
        plan1Label="Base"
        plan2Label="Other"
      />,
    );
    // Both deaths missing on plan 1 => combined total renders "—".
    expect(container.textContent).toContain("Combined Total");
    expect(container.textContent).toContain("—");
  });
});
