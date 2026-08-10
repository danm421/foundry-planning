// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import GoalsBoard from "../goals-board";
import { claimAgeModeHint } from "@/lib/household-map/goals";
import type { GoalKind, MapGoal } from "@/lib/household-map/goals";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import type { HouseholdMapProps, MapPerson } from "@/lib/household-map/types";
import { TEST_CLIENT_INFO, TEST_PLAN_SETTINGS } from "./fixtures";

function person(overrides: Partial<MapPerson> = {}): MapPerson {
  return {
    familyMemberId: "fm-default",
    firstName: "Alex",
    age: 45,
    retirementYear: 2045,
    birthYear: 1980,
    ...overrides,
  };
}

function goal(overrides: Partial<MapGoal> & Pick<MapGoal, "id">): MapGoal {
  return {
    year: 2030,
    kind: "household",
    side: "client",
    title: "Goal title",
    detail: null,
    expenseId: null,
    forFamilyMemberName: null,
    lifeExpectancy: null,
    socialSecurity: null,
    ...overrides,
  };
}

function baseProps(overrides: Partial<HouseholdMapProps> = {}): HouseholdMapProps {
  return {
    clientId: "client-1",
    people: {
      client: person({ familyMemberId: "fm-client", firstName: "Alex" }),
      spouse: person({ familyMemberId: "fm-spouse", firstName: "Jordan", birthYear: 1982 }),
      children: [],
    },
    netWorthLabel: "$500,000",
    items: [],
    goals: [],
    canEdit: true,
    // Editor hydration rows (see HouseholdMapProps). Empty by default — these
    // boards render cards, they don't hydrate editors.
    incomeRows: {},
    ssIncomeRows: {},
    expenseRows: {},
    savingsRuleRows: {},
    savingsSchedules: {},
    flowScenarioFields: {},
    ssScenarioFields: {},
    clientScenarioFields: {},
    planSettingsScenarioFields: {},
    clientInfo: TEST_CLIENT_INFO,
    planSettings: TEST_PLAN_SETTINGS,
    accountOptions: [],
    // Required on `HouseholdMapProps` as of Task 5. This board does not read
    // either one — they are here so the fixture typechecks against the shared
    // props type, which is the point of having a shared props type.
    accountRows: {},
    growthContext: {
      modelPortfolios: [],
      fundPortfolios: [],
      resolvedInflationRate: 0.025,
      categoryDefaults: {},
    },
    // The real fallback map (all ten categories) rather than a hand-rolled
    // literal — `CategoryDefaultRateMap` requires every key, and calling the
    // shipped function keeps the fixture honest if those defaults ever move.
    categoryDefaultRates: buildCategoryDefaultRates(undefined, [], 0),
    assetClassOptions: [],
    portfolioAllocationsMap: {},
    categoryDefaultSources: {},
    businessOptions: [],
    rothIraAccountOptions: [],
    resolvedInflationRate: 0.03,
    familyMemberOptions: [],
    entityOptions: [],
    ...overrides,
  };
}

describe("GoalsBoard", () => {
  it("places a client-side goal in the left cell and a spouse-side goal in the right cell", () => {
    const clientGoal = goal({ id: "g-client", side: "client", year: 2030, title: "Alex retires" });
    const spouseGoal = goal({ id: "g-spouse", side: "spouse", year: 2032, title: "Jordan retires" });

    render(<GoalsBoard {...baseProps({ goals: [clientGoal, spouseGoal] })} />);

    const clientRow = screen.getByTestId(`goal-row-${clientGoal.id}`);
    expect(clientRow.children).toHaveLength(3);
    expect(
      within(clientRow.children[0] as HTMLElement).getByText("Alex retires"),
    ).toBeInTheDocument();
    // Right cell of the client-side row must stay empty — the card did not
    // leak to the wrong side of the spine.
    expect(clientRow.children[2].textContent).toBe("");

    const spouseRow = screen.getByTestId(`goal-row-${spouseGoal.id}`);
    expect(spouseRow.children[0].textContent).toBe("");
    expect(
      within(spouseRow.children[2] as HTMLElement).getByText("Jordan retires"),
    ).toBeInTheDocument();
  });

  it("renders a joint goal as its own full-width straddling row, not dropped", () => {
    const jointGoal = goal({ id: "g-joint", side: "joint", year: 2028, title: "New roof" });

    render(<GoalsBoard {...baseProps({ goals: [jointGoal] })} />);

    const row = screen.getByTestId(`goal-row-${jointGoal.id}`);
    // A joint goal must NOT fall into the client/spouse two-cell grid row —
    // that layout has no cell for "joint" and would silently drop the card.
    expect(row.className).not.toContain("grid-cols-[1fr_88px_1fr]");
    expect(within(row).getByText("New roof")).toBeInTheDocument();
    expect(within(row).getByTestId(`goal-card-joint-${jointGoal.id}`)).toBeInTheDocument();
  });

  it("agesAt derives ages from each person's birthYear, per goal year — not a Date computed in the component", () => {
    const earlyGoal = goal({ id: "g-early", side: "client", year: 2026, title: "Early goal" });
    const laterGoal = goal({ id: "g-later", side: "client", year: 2030, title: "Later goal" });

    render(
      <GoalsBoard
        {...baseProps({
          people: {
            // `age` is a deliberately nonsense placeholder distinct from any
            // birthYear-derived value, so a passing assertion below can only
            // mean the ages line reads `birthYear`, not `age`.
            client: person({ birthYear: 1961, age: 999 }),
            spouse: person({ birthYear: 1963, firstName: "Jordan", age: 999 }),
            children: [],
          },
          goals: [earlyGoal, laterGoal],
        })}
      />,
    );

    // 2026 - 1961 = 65, 2026 - 1963 = 63.
    expect(
      within(screen.getByTestId(`goal-row-${earlyGoal.id}`)).getByText("65 / 63"),
    ).toBeInTheDocument();
    // 2030 - 1961 = 69, 2030 - 1963 = 67 — a different row, a different year,
    // a different pair of ages. A component reading `new Date()` instead of
    // the row's own `year` would render the same ages on both rows.
    expect(
      within(screen.getByTestId(`goal-row-${laterGoal.id}`)).getByText("69 / 67"),
    ).toBeInTheDocument();
  });

  it("single client (people.spouse === null) — ages render without a spouse age or a slash", () => {
    const g = goal({ id: "g-single", side: "client", year: 2026, title: "Solo goal" });

    render(
      <GoalsBoard
        {...baseProps({
          people: { client: person({ birthYear: 1961 }), spouse: null, children: [] },
          goals: [g],
        })}
      />,
    );

    const row = screen.getByTestId(`goal-row-${g.id}`);
    expect(within(row).getByText("65")).toBeInTheDocument();
    expect(within(row).queryByText(/\//)).not.toBeInTheDocument();
  });

  // The hint is gated on real, expense-backed goals rather than a card count.
  // A count threshold showed it to an unmarried household (two milestones) even
  // once that household had a genuine goal, and hid it from a married household
  // with three milestones and none.
  it("renders the hint while there are only life milestones, however many", () => {
    const milestonesOnly = [
      goal({ id: "g1", year: 2026 }),
      goal({ id: "g2", year: 2027 }),
      goal({ id: "g3", year: 2028 }),
      goal({ id: "g4", year: 2029 }),
    ];
    render(<GoalsBoard {...baseProps({ goals: milestonesOnly })} />);
    expect(
      screen.getByText("Tick “Show as a goal” on any expense to add it here."),
    ).toBeInTheDocument();
  });

  it("hides the hint as soon as ONE expense-backed goal exists, even in a two-card household", () => {
    const goals = [goal({ id: "g1", year: 2026 }), goal({ id: "g2", year: 2027, expenseId: "exp-1" })];
    render(<GoalsBoard {...baseProps({ goals })} />);
    expect(
      screen.queryByText("Tick “Show as a goal” on any expense to add it here."),
    ).not.toBeInTheDocument();
  });

  it("renders the beneficiary name so two children's identical goals are distinguishable", () => {
    const goals = [
      goal({ id: "g-kelly", year: 2040, title: "College", forFamilyMemberName: "Kelly" }),
      goal({ id: "g-sam", year: 2043, title: "College", forFamilyMemberName: "Sam" }),
    ];
    render(<GoalsBoard {...baseProps({ goals })} />);

    expect(
      within(screen.getByTestId("goal-row-g-kelly")).getByText("for Kelly"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("goal-row-g-sam")).getByText("for Sam")).toBeInTheDocument();
  });

  // Same writability test the Cash Flow board applies via `isItemEditable`:
  // `handleEditGoalExpense` already refuses to open the drawer for an expense
  // with no hydration row, so without this the card looks clickable and
  // silently does nothing.
  it("a goal whose expense has no hydration row is not a button", () => {
    const g = goal({ id: "g-orphan", expenseId: "exp-gone", title: "Orphaned goal" });
    render(<GoalsBoard {...baseProps({ goals: [g] })} />);

    expect(screen.queryByRole("button", { name: /Orphaned goal/ })).not.toBeInTheDocument();
  });

  it("a goal whose expense DOES have a hydration row is a button", () => {
    const g = goal({ id: "g-live", expenseId: "exp-1", title: "New roof" });
    render(
      <GoalsBoard
        {...baseProps({
          goals: [g],
          expenseRows: {
            "exp-1": {
              id: "exp-1",
              type: "other",
              name: "New roof",
              annualAmount: "20000",
              startYear: 2030,
              endYear: 2030,
              growthRate: "0.03",
            },
          },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /New roof/ })).toBeInTheDocument();
  });

  const KIND_CASES: { kind: GoalKind; label: string; border: string }[] = [
    { kind: "education", label: "Education", border: "var(--color-cat-portfolio)" },
    { kind: "purchase", label: "Purchase", border: "var(--color-crit)" },
    { kind: "household", label: "Household", border: "var(--color-cat-transactions)" },
    { kind: "retirement", label: "Retirement", border: "var(--color-cat-income)" },
    { kind: "life_expectancy", label: "Life expectancy", border: "var(--color-cat-life)" },
    { kind: "social_security", label: "Social Security", border: "var(--color-cat-tax)" },
  ];

  it.each(KIND_CASES)(
    "kind '$kind' gets its own label and accent border colour",
    ({ kind, label, border }) => {
      const g = goal({ id: `g-${kind}`, kind, side: "client", title: `Title for ${kind}` });
      render(<GoalsBoard {...baseProps({ goals: [g] })} />);

      const card = screen.getByTestId(`goal-card-left-${g.id}`);
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(card.style.borderColor).toBe(border);
    },
  );
});

// The board half of the life-expectancy editor. What makes an age editable here
// is the `lifeExpectancy` PAYLOAD on the goal — not its kind, not its side — so
// these all key off that. The payload's own construction (including the
// spouse-with-no-stored-LE case that sets `assumed`) is covered in
// `lib/household-map/__tests__/goals.test.ts`; from here `assumed` is just a
// flag arriving on a prop.
describe("GoalsBoard — inline life-expectancy editing", () => {
  const CARD_ID = {
    client: "milestone:client_life_expectancy",
    spouse: "milestone:spouse_life_expectancy",
  } as const;

  function lifeExpectancyGoal(
    owner: "client" | "spouse",
    over: { age?: number; assumed?: boolean } = {},
  ): MapGoal {
    const age = over.age ?? 92;
    const assumed = over.assumed ?? false;
    // Matches baseProps' people: Alex born 1980, Jordan born 1982.
    const birthYear = owner === "client" ? 1980 : 1982;
    const firstName = owner === "client" ? "Alex" : "Jordan";
    return goal({
      id: CARD_ID[owner],
      kind: "life_expectancy",
      side: owner,
      title: `${firstName}'s life expectancy`,
      // The string the builder emits, so the read-only fallbacks below assert
      // against what production would actually render.
      detail: assumed ? `age ${age} · assumed` : `age ${age}`,
      year: birthYear + age,
      lifeExpectancy: { owner, age, assumed },
    });
  }

  const writer = () => vi.fn().mockResolvedValue(true);

  it("renders the age as a click-to-edit field", () => {
    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("client")] })}
        onSaveLifeExpectancy={writer()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Edit life expectancy for Alex" });
    expect(trigger).toHaveTextContent("92");

    fireEvent.click(trigger);
    // Not "Amount for Alex" — the field holds an age, and calling it an amount
    // to a screen reader is simply wrong (hence `noun` on InlineAmount).
    expect(screen.getByRole("textbox", { name: "Life expectancy for Alex" })).toBeInTheDocument();
  });

  // A `<button>` may not contain another `<button>`. The card-level click
  // handler and this editor are therefore mutually exclusive by construction:
  // life milestones carry `expenseId: null`, so `clickHandlerFor` returns
  // undefined and the card renders as a div. If that ever inverts, the editor
  // becomes unreachable AND the markup becomes invalid.
  it("renders the card as a div, so the editor's button can legally live inside it", () => {
    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("client")] })}
        onSaveLifeExpectancy={writer()}
      />,
    );

    const card = screen.getByTestId(`goal-card-left-${CARD_ID.client}`);
    expect(card.tagName).toBe("DIV");
    expect(
      within(card).getByRole("button", { name: "Edit life expectancy for Alex" }),
    ).toBeInTheDocument();
  });

  // DISCRIMINATING: both cards render the same editor against the same handler,
  // and `owner` is the only thing telling them apart. Getting it from the card's
  // own payload — rather than, say, the last-rendered card — is what keeps a
  // spouse edit out of the client's `lifeExpectancy` column.
  it("each card saves its OWN owner and the newly typed age", async () => {
    const onSave = writer();
    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("client"), lifeExpectancyGoal("spouse")] })}
        onSaveLifeExpectancy={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit life expectancy for Jordan" }));
    const spouseInput = screen.getByRole("textbox", { name: "Life expectancy for Jordan" });
    fireEvent.change(spouseInput, { target: { value: "88" } });
    fireEvent.keyDown(spouseInput, { key: "Enter" });

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith("spouse", 88));

    fireEvent.click(screen.getByRole("button", { name: "Edit life expectancy for Alex" }));
    const clientInput = screen.getByRole("textbox", { name: "Life expectancy for Alex" });
    fireEvent.change(clientInput, { target: { value: "96" } });
    fireEvent.keyDown(clientInput, { key: "Enter" });

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith("client", 96));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  // The editor is gated on the goal's `lifeExpectancy` payload, NOT on its kind
  // or its lack of an expenseId. A retirement milestone acquiring one would
  // offer an age field that writes the life-expectancy column.
  it("a goal with no life-expectancy payload gets no age editor", () => {
    const retirement = goal({
      id: "milestone:client_retirement",
      kind: "retirement",
      side: "client",
      title: "Alex retires",
      detail: "age 65",
    });
    render(
      <GoalsBoard {...baseProps({ goals: [retirement] })} onSaveLifeExpectancy={writer()} />,
    );

    expect(screen.queryByRole("button", { name: /Edit life expectancy/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 65")).toBeInTheDocument();
  });

  // Both fallbacks below still RENDER the age — losing the editor must not lose
  // the number, which is the one thing every viewer of this card came for.
  it("falls back to the static detail string when the viewer may not edit", () => {
    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("client")], canEdit: false })}
        onSaveLifeExpectancy={writer()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Edit life expectancy/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 92")).toBeInTheDocument();
  });

  // Same rule the Cash Flow board applies: a board rendered without a writer
  // must not show a field that silently discards the edit.
  it("falls back to the static detail string when the board has no writer", () => {
    render(<GoalsBoard {...baseProps({ goals: [lifeExpectancyGoal("client")] })} />);

    expect(screen.queryByRole("button", { name: /Edit life expectancy/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 92")).toBeInTheDocument();
  });

  it("flags an assumed age, and only an assumed one", () => {
    const { unmount } = render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("spouse", { age: 95, assumed: true })] })}
        onSaveLifeExpectancy={writer()}
      />,
    );
    expect(screen.getByText("· assumed")).toBeInTheDocument();
    unmount();

    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("spouse", { age: 90, assumed: false })] })}
        onSaveLifeExpectancy={writer()}
      />,
    );
    expect(screen.queryByText("· assumed")).not.toBeInTheDocument();
  });

  // The assumption is the engine's `?? 95`, already driving the projection.
  // Editing the card is how an advisor replaces it with a decision, so the
  // "assumed" state must be editable rather than read-only.
  it("an assumed age is still editable — that is how the assumption gets replaced", async () => {
    const onSave = writer();
    render(
      <GoalsBoard
        {...baseProps({ goals: [lifeExpectancyGoal("spouse", { age: 95, assumed: true })] })}
        onSaveLifeExpectancy={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit life expectancy for Jordan" }));
    const input = screen.getByRole("textbox", { name: "Life expectancy for Jordan" });
    fireEvent.change(input, { target: { value: "87" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith("spouse", 87));
  });
});

// The board half of the Social Security editor. What makes the benefit editable
// is the `socialSecurity` PAYLOAD on the goal — not its kind, not its side — and
// what makes it a PIA field rather than an annual one is `payload.mode`. The
// payload's own construction (which column each mode reads, the claim-age year)
// is covered in `lib/household-map/__tests__/goals.test.ts`.
describe("GoalsBoard — inline Social Security editing", () => {
  const CARD_ID = {
    client: "milestone:client_social_security",
    spouse: "milestone:spouse_social_security",
  } as const;

  function ssGoal(
    owner: "client" | "spouse",
    over: Partial<NonNullable<MapGoal["socialSecurity"]>> = {},
  ): MapGoal {
    const firstName = owner === "client" ? "Alex" : "Jordan";
    const socialSecurity = {
      incomeId: `ss-${owner}`,
      owner,
      mode: "manual_amount" as const,
      amount: 48000,
      claimAgeLabel: "67",
      claimAgeYears: 67,
      claimAgeMode: "years" as const,
      estimatedAnnual: null,
      ...over,
    };
    const ageHint = claimAgeModeHint(socialSecurity.claimAgeMode);
    const agePart = ageHint
      ? `age ${socialSecurity.claimAgeLabel} (${ageHint})`
      : `age ${socialSecurity.claimAgeLabel}`;
    return goal({
      id: CARD_ID[owner],
      kind: "social_security",
      side: owner,
      title: `${firstName} claims Social Security`,
      // The string the builder emits for this payload, so the read-only
      // fallbacks below assert against what production would render.
      detail:
        socialSecurity.mode === "pia_at_fra"
          ? `${agePart} · $${socialSecurity.amount.toLocaleString()}/mo`
          : `${agePart} · $${socialSecurity.amount.toLocaleString()}/yr`,
      year: 2047,
      socialSecurity,
    });
  }

  const writer = () => vi.fn().mockResolvedValue(true);

  /** Both SS writers, which the slot requires together — see `detailSlotFor`. */
  const ssWriters = () => ({
    onSaveSocialSecurity: writer(),
    onSaveSocialSecurityClaimAge: writer(),
  });

  it("renders the annual benefit as a click-to-edit field in manual mode", () => {
    render(<GoalsBoard {...baseProps({ goals: [ssGoal("client")] })} {...ssWriters()} />);

    const trigger = screen.getByRole("button", { name: "Edit annual benefit for Alex" });
    expect(trigger).toHaveTextContent("$48,000");
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Annual benefit for Alex" })).toBeInTheDocument();
  });

  // ── the claim age ────────────────────────────────────────────────────────
  //
  // The second editable figure on the card, and the one that MOVES it: the claim
  // age is what `ssClaim` derives `firstBenefitYear` from, so a saved age lands
  // the card at a different year on the spine. What columns the save writes is
  // `ssClaimAgePatch`'s job (see `lib/inline-edit/__tests__/flow-write.test.ts`);
  // what this half owes is a field that reads back the resolved age and hands the
  // typed one to the right writer.

  it("renders the claim age as its own click-to-edit field", () => {
    render(<GoalsBoard {...baseProps({ goals: [ssGoal("client")] })} {...ssWriters()} />);

    const trigger = screen.getByRole("button", { name: "Edit claim age for Alex" });
    expect(trigger).toHaveTextContent("67");
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Claim age for Alex" })).toBeInTheDocument();
  });

  // DISCRIMINATING: the age and the benefit are two fields on ONE card writing two
  // different column sets. If the age field were wired to the benefit writer the
  // typed 68 would be persisted as a $68 annual benefit — a 200 OK that destroys
  // the number. So this asserts the age writer got the call AND the benefit writer
  // got none.
  it("sends a typed age to the claim-age writer and NOT to the benefit writer", async () => {
    const writers = ssWriters();
    const clientGoal = ssGoal("client");
    render(<GoalsBoard {...baseProps({ goals: [clientGoal] })} {...writers} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit claim age for Alex" }));
    const input = screen.getByRole("textbox", { name: "Claim age for Alex" });
    fireEvent.change(input, { target: { value: "68" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(writers.onSaveSocialSecurityClaimAge).toHaveBeenCalledWith(
        clientGoal.socialSecurity,
        68,
      ),
    );
    expect(writers.onSaveSocialSecurity).not.toHaveBeenCalled();
  });

  // Each card's OWN payload, same rule as the benefit editor: the write site
  // resolves the income row from it, so a crossed payload edits the wrong spouse.
  it("each card's age field saves its own payload", async () => {
    const writers = ssWriters();
    const spouseGoal = ssGoal("spouse", { claimAgeLabel: "70", claimAgeYears: 70 });
    render(
      <GoalsBoard {...baseProps({ goals: [ssGoal("client"), spouseGoal] })} {...writers} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit claim age for Jordan" }));
    const input = screen.getByRole("textbox", { name: "Claim age for Jordan" });
    fireEvent.change(input, { target: { value: "66" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(writers.onSaveSocialSecurityClaimAge).toHaveBeenCalledWith(
        spouseGoal.socialSecurity,
        66,
      ),
    );
    expect(writers.onSaveSocialSecurityClaimAge).toHaveBeenCalledTimes(1);
  });

  // The whole reason the field holds `claimAgeYears` (67.5) and not the label:
  // read mode has to say "67y 6mo" like a human, while the OPEN input must hold
  // the fractional age so committing it round-trips the months instead of
  // dropping them. If the field opened on "67", typing 67 would be a no-op that
  // silently left the 6mo in place.
  it("shows a part-year age as a label but opens the field on the fraction", () => {
    render(
      <GoalsBoard
        {...baseProps({
          goals: [ssGoal("client", { claimAgeLabel: "67y 6mo", claimAgeYears: 67.5 })],
        })}
        {...ssWriters()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Edit claim age for Alex" });
    expect(trigger).toHaveTextContent("67y 6mo");
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Claim age for Alex" })).toHaveValue("67.5");
  });

  // An `fra` / `at_retirement` age is DERIVED and still tracking a DOB or a
  // retirement age; editing it converts the row to an explicit age and ends that
  // tracking. The card has to say so before the click.
  it("marks a derived claim age with its mode, and leaves an explicit one unmarked", () => {
    const { unmount } = render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client", { claimAgeMode: "fra" })] })}
        {...ssWriters()}
      />,
    );
    expect(screen.getByText("(FRA)")).toBeInTheDocument();
    unmount();

    const atRetirement = render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client", { claimAgeMode: "at_retirement" })] })}
        {...ssWriters()}
      />,
    );
    expect(screen.getByText("(at retirement)")).toBeInTheDocument();
    atRetirement.unmount();

    render(<GoalsBoard {...baseProps({ goals: [ssGoal("client")] })} {...ssWriters()} />);
    expect(screen.queryByText(/\(FRA\)|\(at retirement\)/)).not.toBeInTheDocument();
  });

  // DISCRIMINATING: the two modes edit two DIFFERENT columns, and the accessible
  // name is the only thing on screen that says which. A PIA row offering "annual
  // benefit" would be an advisor typing 48000 into a monthly column.
  it("renders the MONTHLY pia as the field in pia mode, named as such", () => {
    render(
      <GoalsBoard
        {...baseProps({
          goals: [ssGoal("client", { mode: "pia_at_fra", amount: 2800, estimatedAnnual: 41664 })],
        })}
        {...ssWriters()}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit monthly PIA for Alex" })).toHaveTextContent(
      "$2,800",
    );
    expect(
      screen.queryByRole("button", { name: /Edit annual benefit/ }),
    ).not.toBeInTheDocument();
    // The derived annual renders BESIDE the PIA, flagged as an estimate — it is
    // own-retirement only, with no spousal or survivor top-up.
    expect(screen.getByText("est. $41,664/yr")).toBeInTheDocument();
  });

  it("shows no estimate line when there is no estimate to show", () => {
    render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client", { mode: "pia_at_fra", amount: 0 })] })}
        {...ssWriters()}
      />,
    );
    // Both writers, so the EDITOR is what's on screen — with one writer the card
    // would fall back to its static detail and this assertion would pass without
    // ever reaching the estimate line.
    expect(screen.getByRole("button", { name: "Edit monthly PIA for Alex" })).toBeInTheDocument();
    expect(screen.queryByText(/est\./)).not.toBeInTheDocument();
  });

  // Same constraint as the life-expectancy card: a `<button>` may not contain
  // another. SS milestones carry `expenseId: null`, so `clickHandlerFor` returns
  // undefined and the card renders as a div.
  it("renders the card as a div, so the editor's button can legally live inside it", () => {
    render(<GoalsBoard {...baseProps({ goals: [ssGoal("client")] })} {...ssWriters()} />);

    const card = screen.getByTestId(`goal-card-left-${CARD_ID.client}`);
    expect(card.tagName).toBe("DIV");
    expect(
      within(card).getByRole("button", { name: "Edit annual benefit for Alex" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Edit claim age for Alex" }),
    ).toBeInTheDocument();
  });

  // DISCRIMINATING: both cards render the same editor against the same handler,
  // and the PAYLOAD is the only thing telling them apart. Passing the card's own
  // payload — rather than an owner the write site would have to re-resolve to a
  // row — is what keeps a spouse edit off the client's income row.
  it("each card saves its OWN payload and the newly typed figure", async () => {
    const onSave = writer();
    const clientGoal = ssGoal("client");
    const spouseGoal = ssGoal("spouse", { amount: 36000 });
    render(
      <GoalsBoard
        {...baseProps({ goals: [clientGoal, spouseGoal] })}
        onSaveSocialSecurity={onSave}
        onSaveSocialSecurityClaimAge={writer()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit annual benefit for Jordan" }));
    const spouseInput = screen.getByRole("textbox", { name: "Annual benefit for Jordan" });
    fireEvent.change(spouseInput, { target: { value: "40000" } });
    fireEvent.keyDown(spouseInput, { key: "Enter" });

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(spouseGoal.socialSecurity, 40000),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit annual benefit for Alex" }));
    const clientInput = screen.getByRole("textbox", { name: "Annual benefit for Alex" });
    fireEvent.change(clientInput, { target: { value: "52000" } });
    fireEvent.keyDown(clientInput, { key: "Enter" });

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(clientGoal.socialSecurity, 52000));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  // Both fallbacks still RENDER the benefit — losing the editor must not lose
  // the number.
  it("falls back to the static detail string when the viewer may not edit", () => {
    render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client")], canEdit: false })}
        {...ssWriters()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Edit annual benefit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit claim age/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 67 · $48,000/yr")).toBeInTheDocument();
  });

  it("falls back to the static detail string when the board has no writer", () => {
    render(<GoalsBoard {...baseProps({ goals: [ssGoal("client")] })} />);

    expect(screen.queryByRole("button", { name: /Edit annual benefit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit claim age/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 67 · $48,000/yr")).toBeInTheDocument();
  });

  // The two SS fields are ONE editable unit: a board handed half the writers
  // renders neither field. That loses no fact — `detail` carries the age, its
  // mode and the benefit — and it is why there is no second render path here for
  // a half-writable card. Asserted in both directions so neither writer can
  // quietly become sufficient on its own.
  it("renders neither SS field when only one of the two writers is present", () => {
    const benefitOnly = render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client")] })}
        onSaveSocialSecurity={writer()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit annual benefit/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 67 · $48,000/yr")).toBeInTheDocument();
    benefitOnly.unmount();

    render(
      <GoalsBoard
        {...baseProps({ goals: [ssGoal("client")] })}
        onSaveSocialSecurityClaimAge={writer()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit claim age/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 67 · $48,000/yr")).toBeInTheDocument();
  });

  // The editor is gated on the goal's `socialSecurity` payload, not on its kind.
  // A retirement milestone acquiring one would offer a benefit field that writes
  // an income row.
  it("a goal with no social-security payload gets no benefit editor", () => {
    const retirement = goal({
      id: "milestone:client_retirement",
      kind: "retirement",
      side: "client",
      title: "Alex retires",
      detail: "age 65",
    });
    render(<GoalsBoard {...baseProps({ goals: [retirement] })} {...ssWriters()} />);

    expect(screen.queryByRole("button", { name: /Edit annual benefit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit claim age/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 65")).toBeInTheDocument();
  });

  // The two writers are independent. A board given only the SS one must still
  // render the life-expectancy age as static text rather than an editor whose
  // save has nowhere to go.
  it("an SS writer alone does not make a life-expectancy age editable", () => {
    const le = goal({
      id: "milestone:client_life_expectancy",
      kind: "life_expectancy",
      side: "client",
      title: "Alex's life expectancy",
      detail: "age 92",
      lifeExpectancy: { owner: "client", age: 92, assumed: false },
    });
    render(<GoalsBoard {...baseProps({ goals: [le, ssGoal("client")] })} {...ssWriters()} />);

    expect(screen.queryByRole("button", { name: /Edit life expectancy/ })).not.toBeInTheDocument();
    expect(screen.getByText("age 92")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit annual benefit for Alex" })).toBeInTheDocument();
  });
});

describe("GoalsBoard — adding a goal", () => {
  it("renders the add button for an editor", () => {
    render(<GoalsBoard {...baseProps()} onAddGoal={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Add goal" })).toBeInTheDocument();
  });

  it("reports the click so the view can open the drawer", () => {
    const onAddGoal = vi.fn();
    render(<GoalsBoard {...baseProps()} onAddGoal={onAddGoal} />);

    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));

    expect(onAddGoal).toHaveBeenCalledTimes(1);
  });

  it("a read-only viewer gets no add button", () => {
    render(<GoalsBoard {...baseProps({ canEdit: false })} onAddGoal={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Add goal" })).not.toBeInTheDocument();
  });

  // A board rendered without the callback must not show a button that silently
  // does nothing — the same gate the inline editors on these boards apply.
  it("no add button without a handler, even for an editor", () => {
    render(<GoalsBoard {...baseProps({ canEdit: true })} />);
    expect(screen.queryByRole("button", { name: "Add goal" })).not.toBeInTheDocument();
  });

  // POSITION, on its own — "at the top" is the requirement, and an
  // "it renders" assertion holds just as well with the button below the spine.
  it("the add button precedes the goal rows in DOM order", () => {
    const goals = [goal({ id: "g1", year: 2030, title: "New roof", expenseId: "exp-1" })];
    render(<GoalsBoard {...baseProps({ goals })} onAddGoal={vi.fn()} />);

    const addButton = screen.getByRole("button", { name: "Add goal" });
    const firstRow = screen.getByTestId("goal-row-g1");

    expect(addButton.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("the empty-state hint points at the button once there is one", () => {
    render(<GoalsBoard {...baseProps()} onAddGoal={vi.fn()} />);
    expect(
      screen.getByText(
        "No goals yet — add one above, or tick “Show as a goal” on an existing expense.",
      ),
    ).toBeInTheDocument();
  });
});
