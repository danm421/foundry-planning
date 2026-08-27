// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnuityTab, annuityContractIncomplete } from "../annuity-tab";

const noop = () => {};
const blank = {
  productType: "fixed" as const, taxTreatment: "non_qualified" as const,
  annualFeePct: 0, incomeMode: "none" as const, rollupRatchets: true,
};

describe("AnnuityTab", () => {
  it("warns when the cost basis is unset — correct LIFO is impossible without it", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />);
    // Targets copy only the WARNING carries. /cost basis/i also matched the
    // field's own <label>, so deleting the warning outright left this green.
    expect(screen.getByText(/will look tax-free/i)).toBeInTheDocument();
  });

  it("hides rider and annuitization fields while the mode is 'none'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />);
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows rider fields when the mode is 'rider'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "rider" }} onChange={noop} />);
    expect(screen.getByLabelText(/benefit base/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows annuitization fields when the mode is 'annuitized'", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByLabelText(/annual payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
  });

  it("warns that annuitizing is irreversible and zeroes the balance", () => {
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByText(/no longer have a cash value|irreversible/i)).toBeInTheDocument();
  });

  it("emits percentages as fractions, not whole numbers", async () => {
    const changes: unknown[] = [];
    render(<AnnuityTab accountId="a" clientId="c" value={{ ...blank, incomeMode: "rider", benefitBase: 100000 }}
      onChange={(v) => changes.push(v)} />);
    await userEvent.type(screen.getByLabelText(/roll-up rate/i), "6");
    expect(changes.at(-1)).toMatchObject({ rollupRate: 0.06 });
  });

  it("warns when a QLAC premium exceeds the 2026 cap", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, productType: "qlac" }} accountValue={250_000} onChange={noop} />);
    expect(screen.getByText(/210,000/)).toBeInTheDocument();
  });

  // ── Beyond the brief ────────────────────────────────────────────────────────
  // The test above proves the warning APPEARS. This one proves it also goes
  // away — together they pin the condition, not just the copy.

  it("drops the cost-basis warning once a basis is entered", () => {
    const { rerender } = render(
      <AnnuityTab accountId="a" clientId="c" value={blank} onChange={noop} />,
    );
    expect(screen.getByText(/will look tax-free/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab accountId="a" clientId="c" value={{ ...blank, costBasis: 80_000 }} onChange={noop} />,
    );
    expect(screen.queryByText(/will look tax-free/i)).not.toBeInTheDocument();
  });

  it("stays quiet about the QLAC cap when the premium is under it", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, productType: "qlac" }} accountValue={190_000} onChange={noop} />);
    expect(screen.queryByText(/210,000/)).not.toBeInTheDocument();
  });

  // `payout.ts` reads `payoutStructure` / `survivorPct` on EVERY income mode,
  // not just an annuitized one — a joint rider that can't name its structure
  // stops paying at the first death.
  it("lets a rider name its payout structure, not just an annuitized contract", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, incomeMode: "rider", benefitBase: 100_000 }} onChange={noop} />);
    expect(screen.getByLabelText(/payout structure/i)).toBeInTheDocument();
  });

  it("asks for the survivor share once the structure is joint", () => {
    render(<AnnuityTab accountId="a" clientId="c"
      value={{ ...blank, incomeMode: "rider", benefitBase: 100_000, payoutStructure: "joint_survivor" }}
      onChange={noop} />);
    expect(screen.getByLabelText(/survivor share/i)).toBeInTheDocument();
  });

  // `payout.ts` reads `survivorPct ?? 0` and treats a null term as "no term at
  // all". A structure named but left un-sized is worse than one never named:
  // the survivor's income stops dead, or the payments never end. Both fields
  // must ANNOUNCE themselves, and the save must be held until they're answered.
  it("says the survivor share is required until it is given one", () => {
    const joint = {
      ...blank, incomeMode: "rider" as const, benefitBase: 100_000,
      payoutStructure: "joint_survivor" as const,
    };
    const { rerender } = render(
      <AnnuityTab accountId="a" clientId="c" value={joint} onChange={noop} />,
    );
    expect(screen.getByText(/pays the survivor nothing/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab accountId="a" clientId="c" value={{ ...joint, survivorPct: 0.5 }} onChange={noop} />,
    );
    expect(screen.queryByText(/pays the survivor nothing/i)).not.toBeInTheDocument();
  });

  it("says the guaranteed term is required until it is given one", () => {
    const certain = {
      ...blank, incomeMode: "annuitized" as const, annuitizedPayment: 40_000,
      payoutStructure: "period_certain" as const,
    };
    const { rerender } = render(
      <AnnuityTab accountId="a" clientId="c" value={certain} onChange={noop} />,
    );
    expect(screen.getByText(/nothing carries to the beneficiary/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab accountId="a" clientId="c" value={{ ...certain, periodCertainYears: 10 }} onChange={noop} />,
    );
    expect(screen.queryByText(/nothing carries to the beneficiary/i)).not.toBeInTheDocument();
  });

  it("emits the mode the advisor picks", async () => {
    const changes: { incomeMode?: string }[] = [];
    render(<AnnuityTab accountId="a" clientId="c" value={blank}
      onChange={(v) => changes.push(v)} />);
    await userEvent.click(screen.getByRole("radio", { name: /income rider/i }));
    expect(changes.at(-1)?.incomeMode).toBe("rider");
  });
});

// The account dialog holds its Save button on this. It mirrors the three CHECK
// constraints on `annuity_contracts`, so a false negative here is a 400 the
// advisor sees instead of an inline "this field is required".
describe("annuityContractIncomplete", () => {
  it("passes a contract that isn't paying income", () => {
    expect(annuityContractIncomplete(blank)).toBe(false);
  });

  it("flags a rider with no benefit base", () => {
    expect(annuityContractIncomplete({
      ...blank, incomeMode: "rider", incomeStartYear: 2032,
    })).toBe(true);
  });

  it("flags an annuitized contract with no payment", () => {
    expect(annuityContractIncomplete({
      ...blank, incomeMode: "annuitized", incomeStartYear: 2032,
    })).toBe(true);
  });

  it("flags income that starts neither on a year nor on a milestone", () => {
    expect(annuityContractIncomplete({
      ...blank, incomeMode: "rider", benefitBase: 100_000,
    })).toBe(true);
  });

  it("takes a milestone in place of a start year", () => {
    expect(annuityContractIncomplete({
      ...blank, incomeMode: "rider", benefitBase: 100_000,
      incomeStartYearRef: "client_retirement",
    })).toBe(false);
  });

  it("passes a fully described annuitized contract", () => {
    expect(annuityContractIncomplete({
      ...blank, incomeMode: "annuitized", annuitizedPayment: 42_000, incomeStartYear: 2032,
    })).toBe(false);
  });

  // Beyond the three DB CHECKs. Neither of these is constrained in Postgres,
  // but `payout.ts` reads `survivorPct ?? 0` and treats a null term as no term
  // — so a structure named without its number is a silently wrong plan, not a
  // rejected one. Holding the save is the only thing that catches it.
  const payingJoint = {
    ...blank, incomeMode: "rider" as const, benefitBase: 100_000, incomeStartYear: 2032,
    payoutStructure: "joint_survivor" as const,
  };
  const payingCertain = {
    ...blank, incomeMode: "annuitized" as const, annuitizedPayment: 40_000, incomeStartYear: 2032,
    payoutStructure: "period_certain" as const,
  };

  it("flags a joint payout that never says what the survivor gets", () => {
    expect(annuityContractIncomplete(payingJoint)).toBe(true);
  });

  it("accepts a joint payout once the survivor share is named", () => {
    expect(annuityContractIncomplete({ ...payingJoint, survivorPct: 0.5 })).toBe(false);
  });

  it("accepts a survivor share of zero — that is a real answer, not a blank", () => {
    expect(annuityContractIncomplete({ ...payingJoint, survivorPct: 0 })).toBe(false);
  });

  it("flags a period-certain payout with no term", () => {
    expect(annuityContractIncomplete(payingCertain)).toBe(true);
  });

  it("flags life-with-period-certain with no term", () => {
    expect(annuityContractIncomplete({
      ...payingCertain, payoutStructure: "life_with_period_certain",
    })).toBe(true);
  });

  it("accepts a period-certain payout once the term is named", () => {
    expect(annuityContractIncomplete({ ...payingCertain, periodCertainYears: 10 })).toBe(false);
  });

  it("asks for neither while the contract isn't paying income", () => {
    expect(annuityContractIncomplete({
      ...blank, payoutStructure: "joint_survivor",
    })).toBe(false);
  });
});
