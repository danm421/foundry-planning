// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BeneficiaryStrip } from "../beneficiary-strip";
import type { BeneficiaryCardData } from "../lib/derive-spine-data";
import type { BeneficiaryDetail } from "../lib/derive-beneficiary-detail";

function detailWithTotal(total: number): BeneficiaryDetail {
  return {
    fromFirstDeath: {
      gross: 0,
      transfers: [],
      drains: { federal_estate_tax: 0, state_estate_tax: 0, admin_expenses: 0, debts_paid: 0, ird_tax: 0 },
      net: 0,
    },
    fromSecondDeath: {
      gross: total,
      transfers: [],
      drains: { federal_estate_tax: 0, state_estate_tax: 0, admin_expenses: 0, debts_paid: 0, ird_tax: 0 },
      net: total,
    },
    inTrust: [],
    total,
  };
}

const baseCard: BeneficiaryCardData = {
  name: "Child A",
  relationship: "child",
  isTrustRemainder: false,
  pctOfHeirs: 0.5,
  detail: detailWithTotal(300_000),
};

describe("BeneficiaryStrip", () => {
  it("only one card is expanded at a time", async () => {
    const user = userEvent.setup();
    render(
      <BeneficiaryStrip
        cards={[
          { ...baseCard, name: "A" },
          { ...baseCard, name: "B" },
        ]}
      />,
    );

    const a = screen.getByRole("button", { name: /A/ });
    expect(a).toHaveAttribute("aria-expanded", "false");
    await user.click(a);
    expect(a).toHaveAttribute("aria-expanded", "true");

    const b = screen.getByRole("button", { name: /B/ });
    await user.click(b);
    expect(b).toHaveAttribute("aria-expanded", "true");
    expect(a).toHaveAttribute("aria-expanded", "false");
  });

  it("toggling open card closes it", async () => {
    const user = userEvent.setup();
    render(<BeneficiaryStrip cards={[baseCard]} />);
    const btn = screen.getByRole("button", { name: /Child A/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
