// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GiftSubForm } from "@/app/(app)/clients/[id]/estate-planning/drop/gift-sub-form";

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
