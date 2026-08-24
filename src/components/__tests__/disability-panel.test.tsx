// @vitest-environment jsdom
/**
 * The Disability panel on the Insurance details page.
 *
 * The decisive tests here are about what the panel is allowed to SEND.
 * `disabilityPolicyUpdateSchema` validates the PATCH BODY, never the merged
 * row — `validateCrossFields` only ever sees the keys the request carried — so
 * the screen is the only thing standing between an advisor and a policy that
 * covers nothing:
 *
 *  - `{hasShortTerm:false}` alone passes, and so does `{hasLongTerm:false}`.
 *    Two one-key PATCHes therefore leave a policy covering NEITHER, the exact
 *    invariant a POST refuses. The dialog must send the pair.
 *  - A body carrying `hasLongTerm:true` but no benefit-period keys comes back
 *    reporting `{mode:"to_age", age:65}` on a row whose age column is NULL —
 *    a 65 nobody entered. Turning long-term coverage on means shipping the
 *    whole long-term block.
 *  - `stdMonthlyMax: null` means UNCAPPED. A form control that round-trips it
 *    as 0 silently pays nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ClientData, ClientInfo, DisabilityPolicy, Income } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import DisabilityPanel, {
  type DisabilityPanelProps,
} from "@/components/disability-panel";
import { DisabilityCoverageTimeline } from "@/components/disability-coverage-timeline";
// The solver's lever pane is the THIRD surface carrying this precedence. It is
// an app-route component rather than a shared one, and importing it here is
// deliberate: the invariant is cross-layer, so the test that pins it has to be.
import { SolverStressTestTab } from "@/app/(app)/clients/[id]/solver/solver-stress-test-tab";
import { ClientAccessProvider } from "@/components/client-access-provider";
import {
  benefitForYear,
  resolveCoverage,
  resolveCoveredEarnings,
} from "@/engine/disability-benefits";
import { WORKPLACE_DEFAULTS } from "@/lib/schemas/disability-policies";

const WORKPLACE: DisabilityPolicy = {
  id: "d1",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  // `monthlyMax: null` is the real group-STD shape and the whole point of the
  // round-trip test below — group short-term is usually uncapped.
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
};

const CLIENT: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reed",
  dateOfBirth: "1980-06-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Jane",
  spouseDob: "1982-03-01",
  filingStatus: "married_joint",
};

function makeProps(over: Partial<DisabilityPanelProps> = {}): DisabilityPanelProps {
  return {
    clientId: "c1",
    policies: [WORKPLACE],
    clientFirstName: "Cooper",
    spouseFirstName: "Jane",
    currentSalaryByPerson: { client: 200_000, spouse: 0 },
    currentYear: 2026,
    // Deliberately EARLIER than `currentYear`. The engine inflates a manual
    // covered-earnings amount by `startYear - planStartYear`, so an equal pair
    // would make the manual tests pass against a preview that ignores inflation
    // entirely — the exact hole the shipped bug hid in.
    planStartYear: 2024,
    inflationRate: 0.03,
    planEndYear: 2060,
    client: CLIENT,
    ...over,
  };
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The dialog's live coverage preview. "Short-term" and "Long-term" each name
 *  three things on this screen — a form section, a row coverage line and a
 *  legend row — so band assertions have to say which one they mean. */
const preview = () =>
  screen.getByRole("heading", { name: /if a disability started this year/i })
    .parentElement as HTMLElement;

function renderPanel(
  permission: "view" | "edit",
  over: Partial<DisabilityPanelProps> = {},
) {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <DisabilityPanel {...makeProps(over)} />
    </ClientAccessProvider>,
  );
}

function fetchMock() {
  return global.fetch as unknown as {
    mock: { calls: [string, { method: string; body: string }][] };
  };
}

/** The body of the LAST request fired, plus its method and URL. */
function lastRequest() {
  const calls = fetchMock().mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const [url, init] = calls[calls.length - 1];
  return { url, method: init.method, body: JSON.parse(init.body) as Record<string, unknown> };
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ policy: { ...WORKPLACE, id: "d1" } }),
  }) as never;
});

describe("DisabilityPanel", () => {
  it("shows an empty state that names what is missing", () => {
    // The empty state's own subtitle and headers are a claim — it must not
    // promise coverage the client does not have.
    renderPanel("edit", { policies: [] });
    expect(screen.getByText(/no disability coverage/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add workplace coverage/i }),
    ).toBeInTheDocument();
  });

  it("summarises a policy as what it pays, not as its stored fields", () => {
    renderPanel("edit");
    expect(screen.getByText(/60% to age 65/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10,000\/mo cap/i)).toBeInTheDocument();
  });

  it("marks a policy taxable or tax-free", () => {
    renderPanel("edit");
    expect(screen.getByText(/taxable/i)).toBeInTheDocument();
  });

  it("hides both add buttons when the viewer has read-only access", () => {
    const withPolicy = renderPanel("view");
    // Vacuity guard: a component that renders NOTHING satisfies every
    // "the button is absent" assertion below, so prove the panel drew first.
    expect(screen.getByRole("heading", { name: "Disability" })).toBeInTheDocument();
    expect(screen.getByText("Group disability")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /add/i })).toHaveLength(0);
    withPolicy.unmount();

    renderPanel("view", { policies: [] });
    expect(screen.getByText(/no disability coverage/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /add/i })).toHaveLength(0);
  });

  it("adds workplace coverage from the shared defaults, keeping an uncapped max null", async () => {
    // No spouse: there is only one person to insure, so the button acts
    // straight away rather than asking who.
    renderPanel("edit", { policies: [], spouseFirstName: null });
    fireEvent.click(screen.getByRole("button", { name: /add workplace coverage/i }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/api/clients/c1/disability-policies");
    expect(req.body).toEqual({ ...WORKPLACE_DEFAULTS, insured: "client" });
    // Explicit, because `toEqual` treats a missing key and an undefined one
    // alike: an uncapped short-term max must travel as a real null.
    expect(req.body.stdMonthlyMax).toBeNull();
  });

  it("surfaces a failed add in the panel rather than an alert", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    renderPanel("edit", { policies: [], spouseFirstName: null });
    fireEvent.click(screen.getByRole("button", { name: /add workplace coverage/i }));

    expect(await screen.findByText(/could not add coverage/i)).toBeInTheDocument();
  });

  it("sends hasShortTerm and hasLongTerm together when a coverage block is switched off", async () => {
    // A one-key PATCH passes validation and can leave the policy covering
    // neither — validateCrossFields never sees the stored row, only the body.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("switch", { name: "Short-term coverage" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.method).toBe("PATCH");
    expect(req.body).toHaveProperty("hasShortTerm", false);
    expect(req.body).toHaveProperty("hasLongTerm"); // the pair, not the one
    expect(req.body.hasLongTerm).toBe(true);
    // The short-term block travels even with short-term switched OFF. Making
    // these keys conditional on `hasShortTerm` is the tidy-up a maintainer
    // reaches for — it mirrors the file's own conditional `ltdBenefitPeriodAge`
    // — and it would ship `stdDurationWeeks` without the companion the
    // duration-vs-wait guard needs in order to run at all.
    expect(req.body).toHaveProperty("stdEliminationDays", 7);
    expect(req.body).toHaveProperty("stdDurationWeeks", 13);
  });

  it("ships the whole long-term block whenever long-term coverage is on", async () => {
    // `{hasShortTerm:true, hasLongTerm:true}` obeys the pairing table and STILL
    // fabricates: on a row whose age column is NULL the response reports
    // `{mode:"to_age", age:65}`. The mode and its companion must travel too.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.body).toHaveProperty("hasLongTerm", true);
    expect(req.body).toHaveProperty("ltdBenefitPeriodMode", "to_age");
    expect(req.body).toHaveProperty("ltdBenefitPeriodAge", 65);
    // The other three pairings the body is the only defence for.
    // `coveredEarningsAmount` travels WITH its mode even in salary mode, where
    // it is a real null: "manual" arriving without an amount is a 400 even when
    // the stored row already holds one.
    expect(req.body).toHaveProperty("coveredEarningsMode", "salary");
    expect(req.body).toHaveProperty("coveredEarningsAmount", null);
    // `{stdDurationWeeks: 1}` on its own PASSES the real update schema — the
    // duration-vs-wait guard only runs when both keys are defined — so the wait
    // must travel with the duration.
    expect(req.body).toHaveProperty("stdEliminationDays", 7);
    expect(req.body).toHaveProperty("stdDurationWeeks", 13);
  });

  it("round-trips an uncapped monthly max as null, never as zero", async () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.body.stdMonthlyMax).toBeNull();
    expect(req.body.ltdMonthlyMax).toBe(10_000);
  });

  /**
   * IF-1's durable half. The reorder itself is two lines; what let these
   * surfaces drift apart in the first place is that NOTHING compared them.
   * Task 9 mirrored the timeline's precedence into the row by hand on the stated
   * invariant "the row and the timeline cannot tell the advisor two different
   * stories about one policy", and a reviewer checked it once, by eye. The
   * solver's lever pane then made the same claim a THIRD time, by hand again.
   *
   * Each surface legitimately words the condition to fit its own space — a pill,
   * a full sentence under a bar, a 233px line — so this asserts on WHICH
   * CONDITION each one reports, never on byte-equal strings.
   */
  describe("the row, the timeline and the solver report the same condition", () => {
    const CONDITIONS = [
      ["no_earnings", /no covered earnings/i],
      ["missing_dob", /date of birth/i],
      ["gap", /months with no benefit/i],
      ["overlap", /both (layers|policies) pay/i],
    ] as const;

    /** The solver's pane reports a deliberate SUBSET: the two conditions that
     *  stop a benefit being paid at all. A gap or overlap between the layers is
     *  a shape it has no room to explain, and the Insurance page says it
     *  properly. Derived from the shared expectation rather than written per
     *  case, so a future editor cannot quietly re-point one case at a different
     *  condition — silence is allowed, disagreement is not. */
    const SOLVER_REPORTS: readonly string[] = ["no_earnings", "missing_dob"];
    const solverExpectationFor = (expected: string | null) =>
      expected !== null && SOLVER_REPORTS.includes(expected) ? expected : null;

    const conditionIn = (text: string): string | null =>
      CONDITIONS.find(([, re]) => re.test(text))?.[0] ?? null;

    /** The same policy, client and covered earnings the other two surfaces saw,
     *  in the shape the solver takes. `growthRate: 0` with the disability year
     *  equal to `planStartYear` makes `resolveCoveredEarnings` return the salary
     *  scalar unchanged, so all three resolve one identical `ResolvedCoverage`.
     *  Zero-salary people get no row at all — which is the real shape of the
     *  non-earning spouse this precedence exists for. */
    const solverTree = (
      policy: DisabilityPolicy,
      client: ClientInfo,
      salary: { client: number; spouse: number },
      withEvent: boolean,
    ): ClientData =>
      ({
        client,
        planSettings: {
          flatFederalRate: 0.22,
          flatStateRate: 0.05,
          inflationRate: 0.03,
          planStartYear: 2026,
          planEndYear: 2060,
          disabilityEvent: withEvent
            ? { person: policy.insured, startYear: 2026 }
            : undefined,
        },
        accounts: [],
        incomes: (["client", "spouse"] as const)
          .filter((who) => salary[who] > 0)
          .map((who) => ({
            id: `inc-${who}`,
            type: "salary",
            name: `${who} salary`,
            annualAmount: salary[who],
            startYear: 2026,
            endYear: 2060,
            growthRate: 0,
            owner: who,
          })),
        expenses: [],
        liabilities: [],
        savingsRules: [],
        withdrawalStrategy: [],
        familyMembers: [],
        giftEvents: [],
        disabilityPolicies: [policy],
      }) as unknown as ClientData;

    const NO_SPOUSE_DOB: ClientInfo = { ...CLIENT, spouseDob: undefined };
    const LATE_LTD = {
      eliminationDays: 180,
      benefitPct: 0.6,
      monthlyMax: 10_000,
      benefitPeriod: { mode: "to_age", age: 65 },
    } as const;
    const LONG_STD = {
      eliminationDays: 7,
      benefitPct: 0.6,
      durationWeeks: 26,
      monthlyMax: null,
    } as const;

    const CASES: {
      name: string;
      policy: DisabilityPolicy;
      client: ClientInfo;
      salary: { client: number; spouse: number };
      expected: string | null;
    }[] = [
      {
        name: "missing DOB alone",
        policy: { ...WORKPLACE, insured: "spouse" },
        client: NO_SPOUSE_DOB,
        salary: { client: 200_000, spouse: 150_000 },
        expected: "missing_dob",
      },
      {
        name: "zero covered earnings alone",
        policy: WORKPLACE,
        client: CLIENT,
        salary: { client: 0, spouse: 0 },
        expected: "no_earnings",
      },
      {
        // The case the old precedence got wrong on BOTH surfaces: adding a date
        // of birth does not make this policy pay, so naming the DOB names a
        // remedy the data contradicts.
        name: "missing DOB AND zero covered earnings",
        policy: { ...WORKPLACE, insured: "spouse" },
        client: NO_SPOUSE_DOB,
        salary: { client: 0, spouse: 0 },
        expected: "no_earnings",
      },
      {
        // Long-term only: both windows are null, so neither layer is on screen
        // to be explained and the DOB — the thing actually missing — is what
        // the advisor needs. The `shortTerm !== null || longTerm !== null`
        // guard is what keeps this case on the DOB message.
        name: "long-term only, missing DOB, zero earnings",
        policy: { ...WORKPLACE, insured: "spouse", shortTerm: null },
        client: NO_SPOUSE_DOB,
        salary: { client: 0, spouse: 0 },
        expected: "missing_dob",
      },
      {
        name: "a real gap between the layers",
        policy: { ...WORKPLACE, longTerm: LATE_LTD },
        client: CLIENT,
        salary: { client: 200_000, spouse: 0 },
        expected: "gap",
      },
      {
        name: "an overlap between the layers",
        policy: { ...WORKPLACE, shortTerm: LONG_STD },
        client: CLIENT,
        salary: { client: 200_000, spouse: 0 },
        expected: "overlap",
      },
      {
        name: "a healthy policy",
        policy: WORKPLACE,
        client: CLIENT,
        salary: { client: 200_000, spouse: 0 },
        expected: null,
      },
    ];

    for (const c of CASES) {
      it(c.name, () => {
        const row = renderPanel("edit", {
          policies: [c.policy],
          client: c.client,
          currentSalaryByPerson: c.salary,
        });
        // Vacuity guard: a surface that rendered nothing reports `null` too, so
        // prove each one drew before comparing what it says.
        expect(screen.getByText("Group disability")).toBeInTheDocument();
        const rowText = within(row.container).getByRole("row", { name: /Group disability/ })
          .textContent!;
        row.unmount();

        // The SAME covered-earnings figure the row resolved for this policy, so
        // the two surfaces are answering one question rather than two.
        const timeline = render(
          <DisabilityCoverageTimeline
            coverage={resolveCoverage(
              c.policy,
              c.salary[c.policy.insured],
              2026,
              c.client,
              2060,
            )}
          />,
        );
        const timelineText = timeline.container.textContent!;
        if (c.expected === null) {
          expect(timeline.container.querySelector('[data-testid="coverage-bar"]')).not.toBeNull();
        } else {
          expect(screen.getByRole("alert")).toBeInTheDocument();
        }
        timeline.unmount();

        const solver = render(
          <SolverStressTestTab
            baseClientData={solverTree(c.policy, c.client, c.salary, false)}
            workingTree={solverTree(c.policy, c.client, c.salary, true)}
            currentYear={2026}
            clientName="Cooper"
            spouseName="Jane"
            onChange={vi.fn()}
            onResetField={vi.fn()}
          />,
        );
        const solverText = solver.container.textContent!;
        // Vacuity guard, both halves: the coverage block drew, and it drew the
        // RESOLVED branch rather than the "no coverage on file" fallback — which
        // would report `null` for every case and agree with nothing.
        expect(solverText).toContain("Pays");
        expect(solverText).not.toContain("No disability coverage on file");
        solver.unmount();

        expect(conditionIn(rowText)).toBe(c.expected);
        expect(conditionIn(timelineText)).toBe(c.expected);
        expect(conditionIn(solverText)).toBe(solverExpectationFor(c.expected));
      });
    }
  });

  it("scopes a missing date of birth to long-term coverage", () => {
    // `resolveCoverage` builds the short-term window from `policy.shortTerm`
    // alone and never consults a date of birth, so short-term still resolves and
    // the projection still pays it. A blanket "this policy pays nothing" would
    // contradict the short-term line rendered right beside it — the same defect
    // Task 8's reviewer fixed in the timeline.
    renderPanel("edit", {
      policies: [{ ...WORKPLACE, insured: "spouse" }],
      client: { ...CLIENT, spouseDob: undefined },
      currentSalaryByPerson: { client: 200_000, spouse: 150_000 },
    });
    expect(screen.getByText(/no date of birth/i).textContent).toMatch(/long-term/i);
    expect(screen.getByText(/60% for 13 weeks/i)).toBeInTheDocument();
    // …and the long-term line is GONE, because the window did not resolve.
    // Gated on the form switch instead, the row advertised "60% to age 65" as
    // live cover while the timeline drew no band for it at all.
    expect(screen.queryByText(/60% to age 65/i)).toBeNull();
  });

  it("says why a policy with no covered earnings pays nothing", () => {
    // Salary mode with no salary rows for the insured — a non-earning spouse,
    // or rows that end before this year. Both bands render at $0/mo and nothing
    // gates them on earnings, so the row must say why.
    renderPanel("edit", { currentSalaryByPerson: { client: 0, spouse: 0 } });
    expect(screen.getByText(/no covered earnings/i)).toBeInTheDocument();
  });

  it("saves a manual covered-earnings policy with its mode and amount together", async () => {
    // No test exercised manual mode at all, which is how a preview that ignored
    // the engine's inflation term survived a review round.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.change(screen.getByLabelText("Covered earnings"), { target: { value: "manual" } });

    // A manual mode with no amount is a 400 on the wire; the dialog must say so
    // rather than let the request go.
    expect(screen.getByText(/manual covered earnings require an amount/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Covered earnings amount"), {
      target: { value: "150000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock().mock.calls.length).toBe(1));
    const req = lastRequest();
    expect(req.body).toHaveProperty("coveredEarningsMode", "manual");
    expect(req.body).toHaveProperty("coveredEarningsAmount", 150_000);
  });

  it("previews manual covered earnings exactly as the projection pays them", () => {
    const manual: DisabilityPolicy = {
      ...WORKPLACE,
      coveredEarningsMode: "manual",
      coveredEarningsAmount: 150_000,
    };
    // The engine's answer, taken with REAL salary rows for the insured. Two
    // things are pinned at once: the manual branch must IGNORE those rows, and
    // it must apply the inflation the panel's old hand-copy left out.
    const incomes: Income[] = [
      {
        id: "i1",
        type: "salary",
        name: "Base pay",
        annualAmount: 200_000,
        startYear: 2020,
        endYear: 2040,
        growthRate: 0,
        owner: "client",
      },
    ];
    const engineEarnings = resolveCoveredEarnings(manual, {
      incomes,
      client: CLIENT,
      startYear: 2026,
      planStartYear: 2024,
      inflationRate: 0.03,
    });
    expect(Math.round(engineEarnings)).toBe(159_135); // 150,000 × 1.03²
    const engineFirstYear = benefitForYear(
      resolveCoverage(manual, engineEarnings, 2026, CLIENT, 2060),
      2026,
      2026,
      0,
    );
    // The figure the raw amount produces, so a preview that quietly drops the
    // inflation term cannot satisfy this test by accident.
    const rawFirstYear = benefitForYear(
      resolveCoverage(manual, 150_000, 2026, CLIENT, 2060),
      2026,
      2026,
      0,
    );
    expect(money.format(rawFirstYear)).not.toBe(money.format(engineFirstYear));

    renderPanel("edit", { policies: [manual] });
    expect(screen.getByText(money.format(engineFirstYear))).toBeInTheDocument();
    expect(screen.queryByText(money.format(rawFirstYear))).toBeNull();
  });

  it("draws no long-term band while the benefit period has no value", () => {
    // `benefitPeriodOf` answered `{mode:"to_age", age:65}` for an EMPTY age
    // field, so the live timeline drew the age-65 window for an age nobody had
    // typed — and switching the mode moved the band to it.
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    // Scoped to the preview: "Short-term" and "Long-term" also name the two
    // form sections and the row's coverage lines.
    expect(within(preview()).getByText("Long-term")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Benefits run to age"), { target: { value: "" } });
    expect(screen.getByLabelText("Benefits run to age")).toHaveValue(null);
    expect(within(preview()).queryByText("Long-term")).toBeNull();
    expect(
      screen.getByText(/long-term coverage is left out below until its benefit period/i),
    ).toBeInTheDocument();
    // Short-term is untouched — the omission is scoped to the layer that lacks
    // a value, exactly as the missing-DOB warning is.
    expect(within(preview()).getByText("Short-term")).toBeInTheDocument();

    // Same fabrication through the other door: pick a mode whose companion is
    // blank and the band must not reappear at `years: 0`.
    fireEvent.change(screen.getByLabelText("Long-term benefits run"), {
      target: { value: "years" },
    });
    expect(within(preview()).queryByText("Long-term")).toBeNull();
  });

  it("keeps a cleared short-term duration blank instead of writing a 0 back", () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.change(screen.getByLabelText("Short-term duration (weeks)"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Short-term duration (weeks)")).toHaveValue(null);
    expect(screen.getByText(/short-term coverage needs a duration in weeks/i)).toBeInTheDocument();
    expect(within(preview()).queryByText("Short-term")).toBeNull();
    expect(within(preview()).getByText("Long-term")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps a deliberate tax-free setting when the premium payer changes", () => {
    renderPanel("edit"); // employer-paid, taxable
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    const taxable = () => screen.getByRole("switch", { name: "Benefits are taxable" });
    expect(taxable()).toBeChecked();

    // The advisor records a split-premium arrangement.
    fireEvent.click(taxable());
    expect(taxable()).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("Who pays the premium"), {
      target: { value: "insured" },
    });
    fireEvent.change(screen.getByLabelText("Who pays the premium"), {
      target: { value: "employer" },
    });
    expect(taxable()).not.toBeChecked(); // the deliberate choice survives
  });

  it("still defaults the tax treatment from a payer the advisor has not overridden", () => {
    // The other half of the brief: seeding must keep working until it is
    // overridden, or "default it from premiumPayer" is not met either.
    renderPanel("edit", { policies: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add policy" }));
    const taxable = () => screen.getByRole("switch", { name: "Benefits are taxable" });
    expect(taxable()).not.toBeChecked(); // a private policy defaults tax-free
    fireEvent.change(screen.getByLabelText("Who pays the premium"), {
      target: { value: "employer" },
    });
    expect(taxable()).toBeChecked();
  });

  it("disarms the remove confirmation as soon as the form is edited", () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove policy" }));
    expect(screen.getByRole("button", { name: "Really remove it?" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Group STD" } });
    expect(screen.queryByRole("button", { name: "Really remove it?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove policy" })).toBeInTheDocument();
    expect(fetchMock().mock.calls.length).toBe(0); // nothing was deleted on the way
  });

  it("shows one alert when a save fails — the save error, above the coverage warning", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    renderPanel("edit", {
      policies: [{ ...WORKPLACE, insured: "spouse" }],
      client: { ...CLIENT, spouseDob: undefined },
      currentSalaryByPerson: { client: 200_000, spouse: 150_000 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    // Before the save there is exactly one: the coverage warning.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/date of birth/i);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saveError = await screen.findByText(/could not save this policy/i);

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(saveError);
    // The coverage warning is still on screen and still readable — it has only
    // stepped out of the live region for the more blocking message.
    const warning = screen.getByText(/no date of birth is on file/i);
    expect(warning).toHaveAttribute("role", "status");
    expect(saveError.compareDocumentPosition(warning)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("names the edit column for a screen reader", () => {
    renderPanel("edit");
    expect(screen.getByRole("columnheader", { name: "Edit" })).toBeInTheDocument();
  });

  it("explains the short-term duration and the taxable switch in the dialog", () => {
    renderPanel("edit");
    fireEvent.click(screen.getByRole("button", { name: "Edit Group disability" }));
    expect(
      screen.getByText(
        /Counted from the first day of disability, so the waiting period is inside it\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Benefits are taxable when the employer pays the premium, and tax-free when you pay it with after-tax dollars\./i,
      ),
    ).toBeInTheDocument();
  });
});
