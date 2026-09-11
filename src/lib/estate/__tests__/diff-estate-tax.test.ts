import { describe, it, expect } from "vitest";
import {
  diffEstateTax,
  diffStateEstateTax,
  grossEstateLineKeys,
} from "@/lib/estate/diff-estate-tax";
import type { EstateTaxResult, GrossEstateLine } from "@/engine/types";
import type { StateEstateTaxResult } from "@/lib/tax/state-estate/types";

function line(over: Partial<GrossEstateLine> = {}): GrossEstateLine {
  return {
    label: "Brokerage",
    accountId: "acct-1",
    liabilityId: null,
    percentage: 1,
    amount: 100,
    isProbate: false,
    ...over,
  };
}

// Only the fields diffEstateTax reads are populated; the rest are zeroed. A
// Partial cast keeps the fixture readable — EstateTaxResult has ~35 fields and
// this module touches six totals plus grossEstateLines.
function tax(over: Partial<EstateTaxResult> = {}): EstateTaxResult {
  return {
    grossEstateLines: [],
    grossEstate: 0,
    taxableEstate: 0,
    tentativeTaxBase: 0,
    federalEstateTax: 0,
    stateEstateTax: 0,
    totalTaxesAndExpenses: 0,
    ...over,
  } as EstateTaxResult;
}

describe("grossEstateLineKeys", () => {
  it("prefers accountId, then liabilityId, then entityId", () => {
    expect(
      grossEstateLineKeys([
        line({ accountId: "a1" }),
        line({ accountId: null, liabilityId: "l1" }),
        line({ accountId: null, liabilityId: null, entityId: "e1" }),
      ]),
    ).toEqual(["a1#0", "l1#0", "e1#0"]);
  });

  it("falls back to the label when every id is null", () => {
    expect(
      grossEstateLineKeys([
        line({ accountId: null, liabilityId: null, entityId: null, label: "Home" }),
      ]),
    ).toEqual(["label:Home#0"]);
  });

  it("disambiguates repeated keys by occurrence so duplicates never collapse", () => {
    expect(
      grossEstateLineKeys([
        line({ accountId: null, liabilityId: null, label: "Home" }),
        line({ accountId: null, liabilityId: null, label: "Home" }),
      ]),
    ).toEqual(["label:Home#0", "label:Home#1"]);
  });
});

describe("diffEstateTax totals", () => {
  it("reports right minus left, so a smaller tax bill is negative", () => {
    const d = diffEstateTax(
      tax({ grossEstate: 8_200_000, totalTaxesAndExpenses: 1_100_000 }),
      tax({ grossEstate: 6_300_000, totalTaxesAndExpenses: 0 }),
    );
    expect(d.totals.grossEstate).toBe(-1_900_000);
    expect(d.totals.totalTaxesAndExpenses).toBe(-1_100_000);
  });

  it("covers every subtotal the reports render", () => {
    const d = diffEstateTax(
      tax(),
      tax({
        grossEstate: 1,
        taxableEstate: 2,
        tentativeTaxBase: 3,
        federalEstateTax: 4,
        stateEstateTax: 5,
        totalTaxesAndExpenses: 6,
      }),
    );
    expect(d.totals).toEqual({
      grossEstate: 1,
      taxableEstate: 2,
      tentativeTaxBase: 3,
      federalEstateTax: 4,
      stateEstateTax: 5,
      totalTaxesAndExpenses: 6,
    });
  });
});

describe("diffEstateTax lines", () => {
  it("marks an unchanged line as same with a zero delta", () => {
    const d = diffEstateTax(
      tax({ grossEstateLines: [line({ amount: 500 })] }),
      tax({ grossEstateLines: [line({ amount: 500 })] }),
    );
    expect(d.lines.get("acct-1#0")).toEqual({
      key: "acct-1#0",
      status: "same",
      delta: 0,
    });
  });

  it("marks a line whose amount moved as changed", () => {
    const d = diffEstateTax(
      tax({ grossEstateLines: [line({ amount: 500 })] }),
      tax({ grossEstateLines: [line({ amount: 300 })] }),
    );
    expect(d.lines.get("acct-1#0")).toEqual({
      key: "acct-1#0",
      status: "changed",
      delta: -200,
    });
  });

  it("marks a line only the right side has as added", () => {
    const d = diffEstateTax(
      tax({ grossEstateLines: [] }),
      tax({ grossEstateLines: [line({ accountId: "acct-9", amount: 900 })] }),
    );
    expect(d.lines.get("acct-9#0")).toEqual({
      key: "acct-9#0",
      status: "added",
      delta: 900,
    });
  });

  it("marks a line only the left side has as removed, with a negative delta", () => {
    const d = diffEstateTax(
      tax({ grossEstateLines: [line({ accountId: "acct-9", amount: 900 })] }),
      tax({ grossEstateLines: [] }),
    );
    expect(d.lines.get("acct-9#0")).toEqual({
      key: "acct-9#0",
      status: "removed",
      delta: -900,
    });
  });

  it("pairs duplicate-label lines by occurrence rather than collapsing them", () => {
    const noIds = { accountId: null, liabilityId: null, entityId: null };
    const d = diffEstateTax(
      tax({
        grossEstateLines: [
          line({ ...noIds, label: "Home", amount: 100 }),
          line({ ...noIds, label: "Home", amount: 200 }),
        ],
      }),
      tax({
        grossEstateLines: [
          line({ ...noIds, label: "Home", amount: 100 }),
          line({ ...noIds, label: "Home", amount: 250 }),
        ],
      }),
    );
    expect(d.lines.get("label:Home#0")?.status).toBe("same");
    expect(d.lines.get("label:Home#1")).toEqual({
      key: "label:Home#1",
      status: "changed",
      delta: 50,
    });
  });
});

describe("diffStateEstateTax", () => {
  it("diffs the four figures the State Death Tax report shows", () => {
    const st = (over: Partial<StateEstateTaxResult>) =>
      ({
        exemption: 0,
        baseForTax: 0,
        amountOverExemption: 0,
        stateEstateTax: 0,
        ...over,
      }) as StateEstateTaxResult;
    expect(
      diffStateEstateTax(
        st({ exemption: 1_000_000, stateEstateTax: 400_000 }),
        st({ exemption: 1_000_000, stateEstateTax: 100_000 }),
      ),
    ).toEqual({
      exemption: 0,
      baseForTax: 0,
      amountOverExemption: 0,
      stateEstateTax: -300_000,
    });
  });
});
