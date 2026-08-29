// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnuityTab, annuityContractIncomplete, toEngineContract } from "../annuity-tab";
import type { ClientMilestones } from "@/lib/milestones";

const noop = () => {};
const blank = {
  productType: "fixed" as const, taxTreatment: "non_qualified" as const,
  annualFeePct: 0, incomeMode: "none" as const, rollupRatchets: true,
};

describe("AnnuityTab", () => {
  it("warns when the cost basis is unset — correct LIFO is impossible without it", () => {
    render(<AnnuityTab value={blank} onChange={noop} />);
    // Targets copy only the WARNING carries. /cost basis/i also matched the
    // field's own <label>, so deleting the warning outright left this green.
    expect(screen.getByText(/will look tax-free/i)).toBeInTheDocument();
  });

  it("no longer offers its own tax-treatment control — Account Type owns it", () => {
    // Two editors of one field is the bug factory `growth-options.ts` exists
    // to prevent, and a contract column disagreeing with the account row the
    // advisor is looking at is exactly that shape.
    render(<AnnuityTab value={blank} onChange={noop} />);
    expect(screen.queryByLabelText(/how it's taxed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Roth money/i })).not.toBeInTheDocument();
  });

  // `selector: "p"` is load-bearing on both of these. The treatment labels also
  // appear in the tooltip copy and, before this change, in the <option> list —
  // so a bare getByText matched the old select and stayed green whether or not
  // the read-only line existed at all.
  it("states the treatment it was handed, so the cost-basis fields have context", () => {
    render(<AnnuityTab value={{ ...blank, taxTreatment: "qualified" }} onChange={noop} />);
    expect(screen.getByText(/IRA or plan money/i, { selector: "p" })).toBeInTheDocument();
  });

  it("follows the treatment it is given rather than a stored default", () => {
    render(<AnnuityTab value={{ ...blank, taxTreatment: "tax_free" }} onChange={noop} />);
    expect(screen.getByText(/Roth money/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText(/IRA or plan money/i, { selector: "p" })).not.toBeInTheDocument();
  });

  it("hides rider and annuitization fields while the mode is 'none'", () => {
    render(<AnnuityTab value={blank} onChange={noop} />);
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows rider fields when the mode is 'rider'", () => {
    render(<AnnuityTab value={{ ...blank, incomeMode: "rider" }} onChange={noop} />);
    expect(screen.getByLabelText(/benefit base/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/annual payment/i)).not.toBeInTheDocument();
  });

  it("shows annuitization fields when the mode is 'annuitized'", () => {
    render(<AnnuityTab value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByLabelText(/annual payment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/benefit base/i)).not.toBeInTheDocument();
  });

  it("warns that annuitizing is irreversible and zeroes the balance", () => {
    render(<AnnuityTab value={{ ...blank, incomeMode: "annuitized" }} onChange={noop} />);
    expect(screen.getByText(/no longer have a cash value|irreversible/i)).toBeInTheDocument();
  });

  it("emits percentages as fractions, not whole numbers", async () => {
    const changes: unknown[] = [];
    render(<AnnuityTab value={{ ...blank, incomeMode: "rider", benefitBase: 100000 }}
      onChange={(v) => changes.push(v)} />);
    await userEvent.type(screen.getByLabelText(/roll-up rate/i), "6");
    expect(changes.at(-1)).toMatchObject({ rollupRate: 0.06 });
  });

  it("warns when a QLAC premium exceeds the 2026 cap", () => {
    render(<AnnuityTab
      value={{ ...blank, productType: "qlac" }} accountValue={250_000} onChange={noop} />);
    expect(screen.getByText(/210,000/)).toBeInTheDocument();
  });

  // ── Beyond the brief ────────────────────────────────────────────────────────
  // The test above proves the warning APPEARS. This one proves it also goes
  // away — together they pin the condition, not just the copy.

  it("drops the cost-basis warning once a basis is entered", () => {
    const { rerender } = render(
      <AnnuityTab value={blank} onChange={noop} />,
    );
    expect(screen.getByText(/will look tax-free/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab value={{ ...blank, costBasis: 80_000 }} onChange={noop} />,
    );
    expect(screen.queryByText(/will look tax-free/i)).not.toBeInTheDocument();
  });

  it("stays quiet about the QLAC cap when the premium is under it", () => {
    render(<AnnuityTab
      value={{ ...blank, productType: "qlac" }} accountValue={190_000} onChange={noop} />);
    expect(screen.queryByText(/210,000/)).not.toBeInTheDocument();
  });

  // `payout.ts` reads `payoutStructure` / `survivorPct` on EVERY income mode,
  // not just an annuitized one — a joint rider that can't name its structure
  // stops paying at the first death.
  it("lets a rider name its payout structure, not just an annuitized contract", () => {
    render(<AnnuityTab
      value={{ ...blank, incomeMode: "rider", benefitBase: 100_000 }} onChange={noop} />);
    expect(screen.getByLabelText(/payout structure/i)).toBeInTheDocument();
  });

  it("asks for the survivor share once the structure is joint", () => {
    render(<AnnuityTab
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
      <AnnuityTab value={joint} onChange={noop} />,
    );
    expect(screen.getByText(/pays the survivor nothing/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab value={{ ...joint, survivorPct: 0.5 }} onChange={noop} />,
    );
    expect(screen.queryByText(/pays the survivor nothing/i)).not.toBeInTheDocument();
  });

  it("says the guaranteed term is required until it is given one", () => {
    const certain = {
      ...blank, incomeMode: "annuitized" as const, annuitizedPayment: 40_000,
      payoutStructure: "period_certain" as const,
    };
    const { rerender } = render(
      <AnnuityTab value={certain} onChange={noop} />,
    );
    expect(screen.getByText(/nothing carries to the beneficiary/i)).toBeInTheDocument();
    rerender(
      <AnnuityTab value={{ ...certain, periodCertainYears: 10 }} onChange={noop} />,
    );
    expect(screen.queryByText(/nothing carries to the beneficiary/i)).not.toBeInTheDocument();
  });

  // ── The preview mount ─────────────────────────────────────────────────────
  // Nothing in this file used to reach the mount: every fixture above omits
  // `incomeStartYear`, so `annuityContractIncomplete` is true for all of them
  // and the branch never ran. Both of these stop short of Chart.js on purpose —
  // with no balance and no birth year the chart returns its "what is missing"
  // note before <Line> is constructed, and there is no `canvas` package here.

  const complete = {
    ...blank, incomeMode: "rider" as const, benefitBase: 100_000, incomeStartYear: 2032,
  };
  const heading = { name: /balance and income over time/i } as const;

  it("mounts the preview once the contract is fully described", () => {
    render(<AnnuityTab value={complete} onChange={noop} />);
    expect(screen.getByRole("heading", heading)).toBeInTheDocument();
    // It got as far as its own gate, which means the contract was mapped for it.
    expect(screen.getByText(/to preview this contract/i)).toBeInTheDocument();
  });

  it("keeps the preview off while the contract is still incomplete", () => {
    const { rerender } = render(
      <AnnuityTab
        value={{ ...complete, incomeStartYear: null }} onChange={noop} />,
    );
    expect(screen.queryByRole("heading", heading)).not.toBeInTheDocument();
    // Liveness: the same tree with the one missing field supplied does mount,
    // so the absence above is the gate and not a broken fixture.
    rerender(<AnnuityTab value={complete} onChange={noop} />);
    expect(screen.getByRole("heading", heading)).toBeInTheDocument();
  });

  it("emits the mode the advisor picks", async () => {
    const changes: { incomeMode?: string }[] = [];
    render(<AnnuityTab value={blank}
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

// The panel maps the contract for the preview a second time — the projection's
// own copy lives in `src/lib/annuities/load-annuity-contracts.ts`, which cannot
// be imported here because it pulls in `@/db`. These pin the two things that
// silently diverge: the field list, and how the income start is resolved.
describe("toEngineContract", () => {
  const milestones: ClientMilestones = {
    planStart: 2026,
    planEnd: 2066,
    clientRetirement: 2039,
    clientEnd: 2056,
  };

  const both = {
    ...blank, incomeMode: "rider" as const, benefitBase: 100_000,
    incomeStartYear: 2032, incomeStartYearRef: "client_retirement" as const,
  };

  // `resolvedStart` in load-client-data.ts is `if (!ref) return stored;` then
  // `resolveMilestone(ref) ?? stored` — the REF wins. Reading them the other way
  // round drew income from 2032 in the preview for a contract the plan starts
  // paying in 2039.
  it("resolves the income start the way the projection does — the milestone wins", () => {
    expect(toEngineContract(both, milestones).incomeStartYear).toBe(2039);
  });

  it("falls back to the stored year, and only then", () => {
    // Liveness for the test above: 2032 is a different year, and it is what a
    // ref that cannot resolve — or no ref at all — leaves behind.
    expect(toEngineContract(both, undefined).incomeStartYear).toBe(2032);
    expect(toEngineContract({ ...both, incomeStartYearRef: null }, milestones).incomeStartYear)
      .toBe(2032);
    expect(toEngineContract({ ...both, incomeStartYear: null }, undefined).incomeStartYear)
      .toBeNull();
  });

  // The type alias on the return makes a NEW engine field a compile error here.
  // This catches the other direction: a field renamed or dropped from the map.
  it("emits every field the engine contract declares", () => {
    expect(Object.keys(toEngineContract(blank, milestones)).sort()).toEqual(
      [
        "annualFeePct", "annuitizedPayment", "benefitBase", "carrier",
        "contractNumberLast4", "costBasis", "expectedReturnYears", "incomeMode",
        "incomeStartYear", "payoutPct", "payoutStructure", "periodCertainYears",
        "productType", "riderFeePct", "rollupEndYear", "rollupRate",
        "rollupRatchets", "surrenderChargePct", "surrenderEndYear",
        "survivorPct", "taxTreatment",
      ].sort(),
    );
  });
});
