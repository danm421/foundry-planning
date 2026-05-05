// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GiftCumulativeTable } from "../gift-cumulative-table";
import type { GiftLedgerYear } from "@/engine/gift-ledger";

function empty(year: number, withSpouse = true): GiftLedgerYear {
  const zero = {
    taxableGiftsThisYear: 0,
    cumulativeTaxableGifts: 0,
    creditUsed: 0,
    giftTaxThisYear: 0,
    cumulativeGiftTax: 0,
  };
  return {
    year,
    giftsGiven: 0,
    taxableGiftsGiven: 0,
    perGrantor: {
      client: { ...zero },
      ...(withSpouse ? { spouse: { ...zero } } : {}),
    },
    totalGiftTax: 0,
  };
}

describe("GiftCumulativeTable", () => {
  it("renders one row per ledger year with year and ages", () => {
    render(
      <GiftCumulativeTable
        ledger={[empty(2026), empty(2027)]}
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerAges={{
          2026: { client: 51, spouse: 47 },
          2027: { client: 52, spouse: 48 },
        }}
        expandedYears={new Set()}
        onToggleYear={() => {}}
        drilldownByYear={new Map()}
      />,
    );
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("51/47")).toBeInTheDocument();
    expect(screen.getByText("52/48")).toBeInTheDocument();
  });

  it("hides spouse columns when ownerNames.spouseName is null", () => {
    render(
      <GiftCumulativeTable
        ledger={[empty(2026, false)]}
        ownerNames={{ clientName: "Cooper", spouseName: null }}
        ownerAges={{ 2026: { client: 51 } }}
        expandedYears={new Set()}
        onToggleYear={() => {}}
        drilldownByYear={new Map()}
      />,
    );
    // No spouse-name-bearing column headers should render.
    expect(screen.queryByText(/Susan/i)).not.toBeInTheDocument();
  });

  it("renders gift tax cells in red when giftTaxThisYear > 0", () => {
    const ledger: GiftLedgerYear[] = [
      {
        ...empty(2030),
        totalGiftTax: 800_000,
        perGrantor: {
          client: {
            taxableGiftsThisYear: 2_000_000,
            cumulativeTaxableGifts: 20_000_000,
            creditUsed: 7_000_000,
            giftTaxThisYear: 800_000,
            cumulativeGiftTax: 800_000,
          },
          spouse: empty(2030).perGrantor.spouse!,
        },
      },
    ];
    const { container } = render(
      <GiftCumulativeTable
        ledger={ledger}
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerAges={{ 2030: { client: 55, spouse: 51 } }}
        expandedYears={new Set()}
        onToggleYear={() => {}}
        drilldownByYear={new Map()}
      />,
    );
    const taxCell = container.querySelector(
      '[data-testid="gift-tax-cell-2030-client"]',
    );
    expect(taxCell).not.toBeNull();
    expect(taxCell!.className).toMatch(/text-red-/);
  });

  it("calls onToggleYear when a row is clicked", () => {
    const onToggleYear = vi.fn();
    render(
      <GiftCumulativeTable
        ledger={[{ ...empty(2026), giftsGiven: 50_000 }]}
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerAges={{ 2026: { client: 51, spouse: 47 } }}
        expandedYears={new Set()}
        onToggleYear={onToggleYear}
        drilldownByYear={new Map()}
      />,
    );
    fireEvent.click(screen.getByTestId("gift-row-2026"));
    expect(onToggleYear).toHaveBeenCalledWith(2026);
  });

  it("renders inline drilldown panel below the row when year is expanded", () => {
    render(
      <GiftCumulativeTable
        ledger={[{ ...empty(2028), giftsGiven: 50_000 }]}
        ownerNames={{ clientName: "Cooper", spouseName: "Susan" }}
        ownerAges={{ 2028: { client: 53, spouse: 49 } }}
        expandedYears={new Set([2028])}
        onToggleYear={() => {}}
        drilldownByYear={
          new Map([
            [
              2028,
              [
                {
                  label: "Caroline Sample",
                  rows: [
                    {
                      description: "Gift 1",
                      amount: 50_000,
                      giftValue: 50_000,
                      exclusion: 40_000,
                      taxableGift: 10_000,
                    },
                  ],
                  subtotal: {
                    amount: 50_000,
                    giftValue: 50_000,
                    exclusion: 40_000,
                    taxableGift: 10_000,
                  },
                },
              ],
            ],
          ])
        }
      />,
    );
    expect(screen.getByText(/Caroline Sample/)).toBeInTheDocument();
    expect(screen.getByText("Gift 1")).toBeInTheDocument();
  });
});
