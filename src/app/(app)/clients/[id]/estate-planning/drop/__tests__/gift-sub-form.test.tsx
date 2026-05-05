// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GiftSubForm } from "@/app/(app)/clients/[id]/estate-planning/drop/gift-sub-form";
import type { GiftLedgerYear } from "@/engine/gift-ledger";

const baseProps = {
  ownerSlicePct: 0.6,
  ownerSliceValueAtToday: 1_200_000,
  growthRateForPreview: 0.05,
  recipientKind: "entity" as const,
  isCashAccount: false,
  yearMin: 2026,
  yearMax: 2060,
};

describe("GiftSubForm", () => {
  it("when 'recurring' is toggled, % field locks to read-only and $ amount becomes required", async () => {
    const user = userEvent.setup();
    render(
      <GiftSubForm
        {...baseProps}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Percent field exists in one-time mode
    const percentInput = screen.getByLabelText(/percent of/i) as HTMLInputElement;
    expect(percentInput).not.toBeDisabled();

    // Toggle recurring
    await user.click(screen.getByLabelText(/recurring/i));

    // % becomes locked (disabled / readonly)
    const percentAfter = screen.queryByLabelText(/percent of/i);
    if (percentAfter) {
      expect(percentAfter).toHaveAttribute("readonly");
    }

    // Annual $ amount input is now visible
    const annual = screen.getByLabelText(/annual amount/i) as HTMLInputElement;
    expect(annual).toBeRequired();
  });

  it("Crummey checkbox is hidden when recipientKind !== 'entity'", () => {
    render(
      <GiftSubForm
        {...baseProps}
        recipientKind="family_member"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/crummey/i)).toBeNull();
  });

  it("Crummey checkbox is visible when recipientKind === 'entity'", () => {
    render(
      <GiftSubForm
        {...baseProps}
        recipientKind="entity"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/crummey/i)).toBeInTheDocument();
  });

  it("on submit one-time, payload includes sliceFraction = percent / 100", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <GiftSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const percentInput = screen.getByLabelText(/percent of/i);
    await user.clear(percentInput);
    await user.type(percentInput, "50");

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "one-time",
        sliceFraction: 0.5,
      }),
    );
  });

  it("on cash-account mode, the % field is replaced by $ as primary input", () => {
    render(
      <GiftSubForm
        {...baseProps}
        isCashAccount
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/percent of/i)).toBeNull();
    expect(screen.getByLabelText(/cash amount/i)).toBeInTheDocument();
  });

  it("live $ helper updates with percent × ownerSliceValueAtToday × (1 + growth)^(year - yearMin)", async () => {
    const user = userEvent.setup();
    render(
      <GiftSubForm
        {...baseProps}
        ownerSliceValueAtToday={1_000_000}
        growthRateForPreview={0.05}
        yearMin={2026}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Default: percent=100, year=yearMin → 1_000_000 × 1.0 × 1.0 = 1_000_000
    expect(screen.getByTestId("gift-live-preview")).toHaveTextContent("1,000,000");

    // Bump year by 2 → 1_000_000 × 1 × 1.05^2 = 1,102,500
    const yearInput = screen.getByLabelText(/year/i);
    await user.clear(yearInput);
    await user.type(yearInput, "2028");
    expect(screen.getByTestId("gift-live-preview")).toHaveTextContent("1,102,500");
  });

  it("recurring toggle is disabled when recipientKind !== 'entity'", () => {
    render(
      <GiftSubForm
        {...baseProps}
        recipientKind="family_member"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/recurring/i)).toBeDisabled();
  });

  it("rejects sliceFraction <= 0 (does not call onSubmit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <GiftSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percentInput = screen.getByLabelText(/percent of/i);
    await user.clear(percentInput);
    await user.type(percentInput, "0");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects sliceFraction > 1 (does not call onSubmit)", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <GiftSubForm
        {...baseProps}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const percentInput = screen.getByLabelText(/percent of/i);
    await user.clear(percentInput);
    await user.type(percentInput, "150");
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

const breachLedger: GiftLedgerYear[] = [{
  year: 2030,
  giftsGiven: 0,
  taxableGiftsGiven: 0,
  perGrantor: {
    client: {
      taxableGiftsThisYear: 0,
      cumulativeTaxableGifts: 14_000_000,
      creditUsed: 5_545_800,
      giftTaxThisYear: 0,
      cumulativeGiftTax: 0,
    },
    spouse: { taxableGiftsThisYear: 0, cumulativeTaxableGifts: 0, creditUsed: 0, giftTaxThisYear: 0, cumulativeGiftTax: 0 },
  },
  totalGiftTax: 0,
}];

describe("GiftSubForm — breach warning", () => {
  it("does not show warning when proposed gift fits within remaining BEA", () => {
    render(
      <GiftSubForm
        ownerSlicePct={1}
        ownerSliceValueAtToday={100_000}
        growthRateForPreview={0}
        recipientKind="entity"
        isCashAccount={true}
        yearMin={2030}
        yearMax={2050}
        giftLedger={[]}
        taxInflationRate={0.025}
        grantor="client"
        ownerFirstName="Cooper"
        getAnnualExclusion={() => 20_000}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Cash amount/i), {
      target: { value: "50000" },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows inline warning when proposed gift breaches BEA", () => {
    render(
      <GiftSubForm
        ownerSlicePct={1}
        ownerSliceValueAtToday={100_000}
        growthRateForPreview={0}
        recipientKind="entity"
        isCashAccount={true}
        yearMin={2030}
        yearMax={2050}
        giftLedger={breachLedger}
        taxInflationRate={0.025}
        grantor="client"
        ownerFirstName="Cooper"
        getAnnualExclusion={() => 20_000}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Cash amount/i), {
      target: { value: "20000000" },
    });
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Cooper/);
    expect(status.textContent).toMatch(/exceed/);
  });

  it("shows no warning for charitable recipients (taxable contribution = 0)", () => {
    render(
      <GiftSubForm
        ownerSlicePct={1}
        ownerSliceValueAtToday={100_000}
        growthRateForPreview={0}
        recipientKind="external_beneficiary"
        recipientIsCharity={true}
        isCashAccount={true}
        yearMin={2030}
        yearMax={2050}
        giftLedger={breachLedger}
        taxInflationRate={0.025}
        grantor="client"
        ownerFirstName="Cooper"
        getAnnualExclusion={() => 20_000}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Cash amount/i), {
      target: { value: "20000000" },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
