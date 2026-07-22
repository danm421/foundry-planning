// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GoalsStep from "../goals-step";
import { SUB_TYPE_BY_CATEGORY } from "@/components/forms/asset-transaction-leg-model";
import { emptyGoals } from "@/lib/imports/assemble/goals";
import type { AssembleGoals, EducationGoal } from "@/lib/imports/assemble/types";

const REAL_ESTATE_SUBTYPES: string[] = SUB_TYPE_BY_CATEGORY.real_estate;

/**
 * `GoalsStep` is controlled (no internal copy of `value`), so a multi-step
 * interaction (add a purchase, THEN act on it) needs somewhere to hold state
 * between renders. This wrapper is that somewhere — `onValueChange` lets a
 * test read the latest committed value without re-deriving it from mock call
 * arguments across two renders.
 */
function ControlledGoalsStep({
  initial,
  onValueChange,
  ...rest
}: Omit<React.ComponentProps<typeof GoalsStep>, "value" | "onChange"> & {
  initial: AssembleGoals;
  onValueChange?: (next: AssembleGoals) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    // `{...rest}` comes FIRST: `rest` carries whatever `onChange` the caller's
    // spread (e.g. `{...baseProps}`, whose `onChange` is an inert `vi.fn()`)
    // included, and an explicit prop after a spread always wins in JSX — put
    // the spread after instead and that inert mock silently replaces this
    // wrapper's real state-updating `onChange`, and no interaction ever
    // reaches the DOM on the next render.
    <GoalsStep
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

/**
 * Spreads over a complete EducationGoal so each test overrides only the
 * field it asserts on. Defaults are deliberately NOT "derived" (except where
 * a test overrides one) — a fixture that defaulted to derived-with-reason
 * everywhere would make "shows no chip on a stated field" fail on chips it
 * never meant to test.
 */
function educationGoalFixture(over: Partial<EducationGoal> = {}): EducationGoal {
  return {
    id: "edu:emma",
    name: { value: "Emma — College", provenance: "document" },
    forFamilyMemberName: { value: "Emma", provenance: "document" },
    annualAmount: { value: 45000, provenance: "stated" },
    startYear: { value: 2028, provenance: "stated" },
    years: { value: 4, provenance: "stated" },
    growthRate: { value: 0.05, provenance: "stated" },
    payShortfallOutOfPocket: { value: false, provenance: "stated" },
    dedicatedAccountNames: [],
    ...over,
  };
}

/**
 * Account options carry `category`/`subType` because `commitGoals` scopes its
 * dedicated-funding resolution to education accounts
 * (`category === "education_savings" || subType === "529"`). A fixture of bare
 * `{ id, name }` would encode a contract the wizard never produces — the same
 * mistake that let the home-purchase percent bug through twelve gates.
 */
const EDU_529 = {
  id: "a1",
  name: "Emma 529 Plan",
  category: "education_savings",
  subType: "529",
};
const JACK_529 = {
  id: "a2",
  name: "Jack 529 Plan",
  category: "education_savings",
  subType: "529",
};
const BROKERAGE = {
  id: "a3",
  name: "Joint Brokerage",
  category: "taxable",
  subType: "brokerage",
};

const baseProps = {
  accountOptions: [EDU_529],
  dependentOptions: ["Emma"],
  currentYear: 2026,
  onChange: vi.fn(),
};

describe("GoalsStep", () => {
  it("renders on an import with no goals at all", () => {
    render(<GoalsStep value={emptyGoals()} {...baseProps} />);
    expect(screen.getByRole("button", { name: /add education goal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add planned purchase/i })).toBeInTheDocument();
  });

  it("shows an Assumed chip on a derived field and its reason", () => {
    const value = {
      ...emptyGoals(),
      education: [
        educationGoalFixture({
          startYear: {
            value: 2028,
            provenance: "derived",
            reason: "First year of college at age 18, from Emma's 2010 birth year.",
          },
        }),
      ],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.getByText(/first year of college at age 18/i)).toBeInTheDocument();
  });

  it("shows no chip on a stated field", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: 45000, provenance: "stated" } })],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.queryByText(/assumed/i)).not.toBeInTheDocument();
  });

  it("flags a goal whose annual cost is blank as not-yet-committable", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: null, provenance: "derived" } })],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    expect(screen.getByText(/add an annual cost/i)).toBeInTheDocument();
  });

  it("marks an edited field as stated", () => {
    const onChange = vi.fn();
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ annualAmount: { value: null, provenance: "derived" } })],
    };
    render(<GoalsStep value={value} {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/annual cost/i), { target: { value: "45000" } });
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.education[0].annualAmount).toEqual({ value: 45000, provenance: "stated" });
  });

  it("adds and removes a planned purchase", () => {
    const onChange = vi.fn();
    render(<GoalsStep value={emptyGoals()} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add planned purchase/i }));
    expect(onChange.mock.calls.at(-1)![0].homePurchases).toHaveLength(1);
  });

  it("adds an education goal", () => {
    const onChange = vi.fn();
    render(<GoalsStep value={emptyGoals()} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add education goal/i }));
    expect(onChange.mock.calls.at(-1)![0].education).toHaveLength(1);
  });

  it("removes an education goal", () => {
    const onChange = vi.fn();
    const value = { ...emptyGoals(), education: [educationGoalFixture()] };
    render(<GoalsStep value={value} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange.mock.calls.at(-1)![0].education).toHaveLength(0);
  });
});

/**
 * FIX 1 (Critical) — a planned purchase is ALWAYS a home (`HomePurchaseGoal`
 * has no `assetCategory` field; `toBuyLeg` hardcodes `assetCategory:
 * "real_estate"` every render). The shared `BuyLegEditor`'s Category select
 * is otherwise unconditionally live for every `AssetCategory` — reachable by
 * any advisor who clicks the dropdown once, and it corrupts state silently:
 * the category select LOOKS reset to Real Estate on the next render (because
 * `toBuyLeg` overwrites it), but `assetSubType` is left holding a value from
 * the category the advisor picked, which is outside real_estate's own
 * subtype list and gets committed as-is by `commit/goals.ts`.
 */
describe("GoalsStep — planned-purchase category lock (FIX 1)", () => {
  it("offers no category besides Real Estate for a planned purchase", () => {
    render(<ControlledGoalsStep initial={emptyGoals()} {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /add planned purchase/i }));
    const categorySelect = screen.getByLabelText(/asset category/i) as HTMLSelectElement;
    const optionLabels = within(categorySelect)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(optionLabels).toEqual(["Real Estate"]);
  });

  it("never lets assetSubType end up outside real_estate's list, even if the category select is forced", () => {
    let latest: AssembleGoals = emptyGoals();
    render(
      <ControlledGoalsStep
        initial={emptyGoals()}
        onValueChange={(v) => {
          latest = v;
        }}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add planned purchase/i }));
    const categorySelect = screen.getByLabelText(/asset category/i) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "business" } });
    expect(REAL_ESTATE_SUBTYPES).toContain(latest.homePurchases[0].assetSubType);
  });

  it("never lets an assetCategory key land on home-purchase goal state", () => {
    let latest: AssembleGoals = emptyGoals();
    render(
      <ControlledGoalsStep
        initial={emptyGoals()}
        onValueChange={(v) => {
          latest = v;
        }}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add planned purchase/i }));
    const categorySelect = screen.getByLabelText(/asset category/i) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "business" } });
    expect(latest.homePurchases[0]).not.toHaveProperty("assetCategory");
  });
});

/**
 * FIX 2 (Important) — `payShortfallOutOfPocket`'s chip must stay a SIBLING of
 * the checkbox's `<label>`, same rule `FieldLabel` documents: nesting it
 * folds the reason prose into the checkbox's accessible name.
 */
describe("GoalsStep — shortfall checkbox chip placement (FIX 2)", () => {
  it("keeps the checkbox's accessible name free of the Assumed reason text", () => {
    const value = {
      ...emptyGoals(),
      education: [
        educationGoalFixture({
          payShortfallOutOfPocket: {
            value: false,
            provenance: "derived",
            reason: "Any cost the 529 cannot cover is left as an unfunded shortfall until you say otherwise.",
          },
        }),
      ],
    };
    render(<GoalsStep value={value} {...baseProps} />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Pay any shortfall from household cash",
    });
    expect(checkbox).toBeInTheDocument();
    // The reason text is still on the page (inside the chip's tooltip) — it
    // just must not be PART OF the checkbox's own accessible name.
    expect(screen.getByText(/unfunded shortfall/i)).toBeInTheDocument();
  });
});

/**
 * FIX 3 (Important) — dedicated-529-funding had zero coverage. This feeds
 * `commit/goals.ts`'s per-name FIFO queue (`commit/goals.ts:82-88`), which
 * matches by trimmed/lowercased NAME, not id — pushing an id, or any string
 * other than the account's exact `name`, silently breaks every dedicated
 * funding link while every other test stays green.
 */
describe("GoalsStep — dedicated 529 funding (FIX 3)", () => {
  it("adds the account's exact name (not its id) to dedicatedAccountNames when checked", () => {
    const onChange = vi.fn();
    const value = { ...emptyGoals(), education: [educationGoalFixture()] };
    render(<GoalsStep value={value} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Emma 529 Plan" }));
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.education[0].dedicatedAccountNames).toEqual(["Emma 529 Plan"]);
  });

  it("removes the name again when unchecked — a full toggle-on/toggle-off round trip", () => {
    const onChange = vi.fn();
    const checked = {
      ...emptyGoals(),
      education: [educationGoalFixture({ dedicatedAccountNames: ["Emma 529 Plan"] })],
    };
    render(<GoalsStep value={checked} {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Emma 529 Plan" }));
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.education[0].dedicatedAccountNames).toEqual([]);
  });

  it("preserves click order across two dedicated 529s", () => {
    const onChange = vi.fn();
    const twoAccounts = [EDU_529, JACK_529];
    const value = { ...emptyGoals(), education: [educationGoalFixture()] };
    const { rerender } = render(
      <GoalsStep value={value} {...baseProps} accountOptions={twoAccounts} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Jack 529 Plan" }));
    let next = onChange.mock.calls.at(-1)![0];
    rerender(
      <GoalsStep value={next} {...baseProps} accountOptions={twoAccounts} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Emma 529 Plan" }));
    next = onChange.mock.calls.at(-1)![0];
    expect(next.education[0].dedicatedAccountNames).toEqual(["Jack 529 Plan", "Emma 529 Plan"]);
  });
});

/**
 * FINAL-REVIEW FINDINGS 2 + 4.
 *
 * 4: `commitGoals` resolves an education goal's dedicated funding ONLY against
 *    education accounts. A checkbox for a taxable brokerage therefore offers
 *    something the commit silently refuses.
 * 2: `dedicatedAccountNames` is resolved by NAME against rows a DIFFERENT tab
 *    wrote. A rename in the Accounts step, an unresolved fuzzy row, or a fuzzy
 *    match onto a differently-named DB account all leave a name that resolves
 *    to nothing — and the funding block used to be hidden entirely when no
 *    accounts were committed yet, which is exactly when that happens.
 */
describe("GoalsStep — funding-list scoping and unmatched references", () => {
  function homePurchaseFixture() {
    return {
      id: "home-1",
      name: "Austin home",
      year: "2029",
      assetName: "123 Main St",
      assetSubType: "primary_residence",
      purchasePrice: "700000",
      growthRate: "3.5",
      basis: "",
      fundingAccountId: "",
      showMortgage: false,
      mortgageAmount: "",
      mortgageRate: "",
      mortgageTermMonths: "360",
    };
  }

  it("offers only education accounts as dedicated 529 funding", () => {
    const value = { ...emptyGoals(), education: [educationGoalFixture()] };
    render(
      <GoalsStep value={value} {...baseProps} accountOptions={[EDU_529, BROKERAGE]} />,
    );
    expect(screen.getByRole("checkbox", { name: "Emma 529 Plan" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Joint Brokerage" })).not.toBeInTheDocument();
  });

  it("still offers every account as a planned-purchase down-payment source", () => {
    // Deliberately UNSCOPED (Task 8 decision): a down payment can come from any
    // account. Only the education funding list above is filtered.
    const value = { ...emptyGoals(), homePurchases: [homePurchaseFixture()] };
    render(
      <GoalsStep value={value} {...baseProps} accountOptions={[EDU_529, BROKERAGE]} />,
    );
    expect(screen.getByRole("option", { name: "Joint Brokerage" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Emma 529 Plan" })).toBeInTheDocument();
  });

  it("surfaces a dedicated-funding name with no matching account, even with zero account options", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ dedicatedAccountNames: ["Emma 529 Plan"] })],
    };
    render(<GoalsStep value={value} {...baseProps} accountOptions={[]} />);
    expect(screen.getByText(/no committed account named/i)).toBeInTheDocument();
    expect(screen.getByText("Emma 529 Plan")).toBeInTheDocument();
  });

  it("flags a name that only matches a NON-education account — commitGoals will not resolve it", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ dedicatedAccountNames: ["Joint Brokerage"] })],
    };
    render(<GoalsStep value={value} {...baseProps} accountOptions={[BROKERAGE]} />);
    expect(screen.getByText(/no committed account named/i)).toBeInTheDocument();
  });

  it("does not flag a name that matches a committed education account", () => {
    const value = {
      ...emptyGoals(),
      education: [educationGoalFixture({ dedicatedAccountNames: ["Emma 529 Plan"] })],
    };
    render(<GoalsStep value={value} {...baseProps} accountOptions={[EDU_529]} />);
    expect(screen.queryByText(/no committed account named/i)).not.toBeInTheDocument();
  });

  it("drops an unmatched name when the advisor removes it", () => {
    const onChange = vi.fn();
    const value = {
      ...emptyGoals(),
      education: [
        educationGoalFixture({ dedicatedAccountNames: ["Renamed 529", "Emma 529 Plan"] }),
      ],
    };
    render(
      <GoalsStep
        value={value}
        {...baseProps}
        accountOptions={[EDU_529]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove funding account Renamed 529/i }));
    const next = onChange.mock.calls.at(-1)![0];
    // Only the unmatched name goes; the resolvable one is untouched.
    expect(next.education[0].dedicatedAccountNames).toEqual(["Emma 529 Plan"]);
  });
});
