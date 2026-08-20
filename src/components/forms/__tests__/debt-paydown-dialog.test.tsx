// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Liability } from "@/engine/types";
import DebtPaydownDialog from "../debt-paydown-dialog";
import type { DebtPaydownRow } from "@/lib/solver/debt-paydown";

function liability(over: Partial<Liability> = {}): Liability {
  return {
    id: "liab-1",
    name: "Primary Mortgage",
    balance: 275_000,
    interestRate: 0.06,
    monthlyPayment: 1798.65,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    balanceAsOfYear: 2026,
    balanceAsOfMonth: 1,
    liabilityType: "mortgage",
    extraPayments: [],
    owners: [],
    ...over,
  };
}

const CARD = liability({
  id: "liab-card",
  name: "Chase Visa",
  liabilityType: "credit_card",
  balance: 8_000,
});

function renderDialog(over: Partial<React.ComponentProps<typeof DebtPaydownDialog>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <DebtPaydownDialog
      liabilities={[liability()]}
      rows={{}}
      minYear={2026}
      onClose={onClose}
      onSubmit={onSubmit}
      {...over}
    />,
  );
  return { onSubmit, onClose };
}

describe("DebtPaydownDialog", () => {
  it("lists one fillable row per amortizing loan", () => {
    renderDialog({ liabilities: [liability(), liability({ id: "liab-2", name: "Car Loan" })] });
    expect(screen.getByText("Primary Mortgage")).toBeTruthy();
    expect(screen.getByText("Car Loan")).toBeTruthy();
    expect(screen.getByLabelText("Extra payment for Primary Mortgage")).toBeTruthy();
    expect(screen.getByLabelText("Frequency for Car Loan")).toBeTruthy();
  });

  it("shows no impact until an amount is entered, then previews the payoff shift", () => {
    renderDialog();
    expect(screen.queryByText(/saves \$/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "500" },
    });

    // 2049 → an earlier year, plus the interest saved.
    expect(screen.getByText("2049")).toBeTruthy();
    expect(screen.getAllByText(/saves \$[\d,]+/).length).toBeGreaterThan(0);
  });

  it("says how much of an oversized payment the loan can actually take", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Frequency for Primary Mortgage"), {
      target: { value: "one_time" },
    });
    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "5000000" },
    });
    expect(screen.getByText(/of \$5,000,000/)).toBeTruthy();
  });

  it("hides the end year for a one-time payment", () => {
    renderDialog();
    expect(screen.getByLabelText("End year for Primary Mortgage")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Frequency for Primary Mortgage"), {
      target: { value: "one_time" },
    });
    expect(screen.queryByLabelText("End year for Primary Mortgage")).toBeNull();
  });

  it("submits only the loans whose plan changed, trimmed to what the loan can absorb", () => {
    const { onSubmit, onClose } = renderDialog({
      liabilities: [liability(), liability({ id: "liab-2", name: "Car Loan" })],
    });

    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "4000" },
    });
    fireEvent.change(screen.getByLabelText("End year for Primary Mortgage"), {
      target: { value: "2049" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const changes = onSubmit.mock.calls[0][0] as { liabilityId: string; value: DebtPaydownRow }[];
    expect(changes).toHaveLength(1); // the untouched Car Loan is not emitted
    expect(changes[0].liabilityId).toBe("liab-1");
    expect(changes[0].value.amount).toBe(4000);
    // The window is trimmed to the year the balance reaches zero.
    expect(changes[0].value.endYear).toBeLessThan(2049);
    expect(onClose).toHaveBeenCalled();
  });

  it("clears a paydown when its amount is emptied", () => {
    const existing: DebtPaydownRow = {
      liabilityId: "liab-1",
      frequency: "monthly",
      amount: 500,
      startYear: 2027,
      endYear: 2035,
    };
    const { onSubmit } = renderDialog({ rows: { "liab-1": existing } });

    expect((screen.getByLabelText("Extra payment for Primary Mortgage") as HTMLInputElement).value)
      .toBe("500");

    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSubmit.mock.calls[0][0]).toEqual([{ liabilityId: "liab-1", value: null }]);
  });

  it("preserves a paydown switched off in the technique list", () => {
    const existing: DebtPaydownRow = {
      liabilityId: "liab-1",
      frequency: "monthly",
      amount: 500,
      startYear: 2027,
      endYear: 2035,
      enabled: false,
    };
    const { onSubmit } = renderDialog({ rows: { "liab-1": existing } });
    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const changes = onSubmit.mock.calls[0][0] as { value: DebtPaydownRow }[];
    expect(changes[0].value.enabled).toBe(false);
  });

  it("names loans it cannot model instead of dropping them silently", () => {
    renderDialog({ liabilities: [liability(), CARD] });
    expect(screen.queryByLabelText("Extra payment for Chase Visa")).toBeNull();
    expect(screen.getByText(/Not shown: Chase Visa/)).toBeTruthy();
  });

  it("says so, and disables saving, when there is nothing to pay down", () => {
    renderDialog({ liabilities: [CARD] });
    expect(screen.getByText(/no amortizing loans/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("totals the funded loans", () => {
    renderDialog({ liabilities: [liability(), liability({ id: "liab-2", name: "Car Loan" })] });
    expect(screen.getByText("No extra payments yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Extra payment for Primary Mortgage"), {
      target: { value: "500" },
    });
    expect(screen.getByText("1 of 2 loans")).toBeTruthy();
  });
});
