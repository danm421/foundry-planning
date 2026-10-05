// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SolverGoalsSection } from "../solver-goals-section";
import type { ClientData, Expense } from "@/engine/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const goal: Expense = {
  id: "goal-1",
  type: "education",
  name: "College — Emma",
  annualAmount: 30000,
  startYear: 2032,
  endYear: 2035,
  growthRate: 0.05,
  dedicatedAccountIds: ["529-emma"],
  payShortfallOutOfPocket: false,
} as unknown as Expense;

const workingTree = {
  expenses: [goal],
  accounts: [
    {
      id: "529-emma",
      name: "529 — Emma",
      category: "cash",
      subType: "529",
      owners: [{ kind: "family_member", familyMemberId: "emma", percent: 100 }],
    },
  ],
  savingsRules: [
    { id: "r1", accountId: "529-emma", annualAmount: 6000, isDeductible: false, startYear: 2026, endYear: 2035 },
  ],
  incomes: [],
} as unknown as ClientData;

describe("SolverGoalsSection", () => {
  it("lists goals and removes one via expense-upsert null", () => {
    const onChange = vi.fn();
    render(
      <SolverGoalsSection
        baseExpenses={[goal]}
        workingTree={workingTree}
        currentYear={2026}
        clientId="c1"
        source="base"
        mutations={[]}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("College — Emma")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove college — emma/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: "expense-upsert", id: "goal-1", value: null });
  });

  it("solves to the chosen funding percent, defaulting the input to 100", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ additionalAnnual: 1500, reachesTarget: true, targetPct: 0.7 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SolverGoalsSection
        baseExpenses={[goal]}
        workingTree={workingTree}
        currentYear={2026}
        clientId="c1"
        source="base"
        mutations={[]}
        onChange={vi.fn()}
      />,
    );
    const pctInput = screen.getByLabelText(/fund 529 — emma to percent/i) as HTMLInputElement;
    expect(pctInput.value).toBe("100"); // fund it fully unless the advisor says otherwise

    fireEvent.change(pctInput, { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: /solve 529 — emma/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The tab's own year rides along, so the solve picks the same savings rule
    // Apply will — not the plan's first projection year.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      goalId: "goal-1", targetPct: 0.7, currentYear: 2026,
    });
    // The result names the target it solved for, not "fully funds".
    expect(await screen.findByText(/\+\$1,500\/yr funds 70% of this goal/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("adds a goal with a new 529, emitting account → rule → expense in order", () => {
    const onChange = vi.fn();
    const tree = {
      ...workingTree,
      familyMembers: [{ id: "emma", role: "child", firstName: "Emma", lastName: null }],
    } as unknown as ClientData;
    render(
      <SolverGoalsSection
        baseExpenses={[goal]}
        workingTree={tree}
        currentYear={2026}
        growth529={0.06}
        clientId="c1"
        source="base"
        mutations={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Education goal" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "College — Emma" } });
    fireEvent.change(screen.getByLabelText("For"), { target: { value: "emma" } });
    fireEvent.change(screen.getByLabelText("Start year"), { target: { value: "2032" } });
    fireEvent.change(screen.getByLabelText("Number of years"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /new 529 plan/i }));
    fireEvent.change(screen.getByLabelText("Starting balance"), { target: { value: "15000" } });
    fireEvent.change(screen.getByLabelText("Annual contribution"), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    const kinds = onChange.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(["account-upsert", "savings-rule-upsert", "expense-upsert"]);
    const accountMut = onChange.mock.calls[0][0];
    expect(accountMut.value).toMatchObject({
      category: "education_savings",
      education529: { beneficiaryFamilyMemberId: "emma" },
    });
    const expenseMut = onChange.mock.calls[2][0];
    expect(expenseMut.value.forFamilyMemberId).toBe("emma");
    expect(expenseMut.value.dedicatedAccountIds).toContain(accountMut.id);
  });

  it("lists an Other goal with no savings account as paid from cash flow, by start year", () => {
    const car = {
      id: "car", type: "other", name: "New car", annualAmount: 60000,
      startYear: 2029, endYear: 2029, growthRate: 0.025, isGoal: true, dedicatedAccountIds: [],
    } as unknown as Expense;
    const tree = { ...workingTree, expenses: [goal, car] } as unknown as ClientData;
    render(
      <SolverGoalsSection
        baseExpenses={[goal, car]} workingTree={tree} currentYear={2026}
        clientId="c1" source="base" mutations={[]} onChange={vi.fn()}
      />,
    );
    const names = screen.getAllByTestId("goal-name").map((n) => n.textContent);
    expect(names).toEqual(["New car", "College — Emma"]); // 2029 before 2032
    expect(screen.getByText("Paid from cash flow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add savings account" }));
    expect(screen.getByRole("button", { name: /save goal/i })).toBeInTheDocument();
  });

  it("leaves out an Other expense that isn't marked as a goal", () => {
    const gym = {
      id: "gym", type: "other", name: "Gym", annualAmount: 1200,
      startYear: 2026, endYear: 2040, growthRate: 0.025,
    } as unknown as Expense;
    const tree = { ...workingTree, expenses: [goal, gym] } as unknown as ClientData;
    render(
      <SolverGoalsSection
        baseExpenses={[goal, gym]} workingTree={tree} currentYear={2026}
        clientId="c1" source="base" mutations={[]} onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Gym")).toBeNull();
  });

  it("adds an Other goal through the chooser", () => {
    const onChange = vi.fn();
    render(
      <SolverGoalsSection
        baseExpenses={[goal]} workingTree={workingTree} currentYear={2026}
        clientId="c1" source="base" mutations={[]} onChange={onChange}
        owners={[{ familyMemberId: "fm-1", label: "Harold" }]} growthTaxable={0.06} inflationRate={0.025}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Other goal" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wedding" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ kind: "expense-upsert", value: { type: "other", isGoal: true, name: "Wedding" } });
  });

  describe("contribution on an account the household already saves into", () => {
    // A New-car goal paid in 2029 from a brokerage whose household savings rule
    // runs to 2045: the goal's contribution is its OWN rule, not that one.
    const car = {
      id: "car", type: "other", name: "New car", annualAmount: 60000,
      startYear: 2029, endYear: 2029, growthRate: 0.025, isGoal: true, dedicatedAccountIds: ["brk"],
    } as unknown as Expense;
    const general = {
      id: "gen", accountId: "brk", annualAmount: 6000, isDeductible: false, startYear: 2026, endYear: 2045,
    };
    const tree = {
      ...workingTree,
      expenses: [car],
      accounts: [
        {
          id: "brk", name: "Brokerage", category: "taxable", subType: "brokerage",
          owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }],
        },
      ],
      savingsRules: [general],
    } as unknown as ClientData;

    const renderCar = (onChange = vi.fn(), workingTree: ClientData = tree) => {
      const view = render(
        <SolverGoalsSection
          baseExpenses={[car]} workingTree={workingTree} currentYear={2026}
          clientId="c1" source="base" mutations={[]} onChange={onChange}
        />,
      );
      return { onChange, view };
    };
    const solveAndApply = async (additionalAnnual: number) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ additionalAnnual, reachesTarget: true, targetPct: 1 }),
      }));
      fireEvent.click(screen.getByRole("button", { name: /solve brokerage/i }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
      vi.unstubAllGlobals();
    };
    const ruleUpserts = (onChange: ReturnType<typeof vi.fn>) =>
      onChange.mock.calls.map((c) => c[0]).filter((m) => m.kind === "savings-rule-upsert");

    it("Apply writes a goal rule ending with the goal, never the household rule", async () => {
      const { onChange } = renderCar();
      await solveAndApply(2000);

      const upserts = ruleUpserts(onChange);
      expect(upserts).toEqual([
        {
          kind: "savings-rule-upsert",
          id: expect.stringMatching(UUID),
          value: expect.objectContaining({
            accountId: "brk", annualAmount: 2000, startYear: 2026, endYear: 2029, isDeductible: false,
          }),
        },
      ]);
      // A scenario stores the id in a uuid column; the mutation and the rule agree.
      expect(upserts[0].value.id).toBe(upserts[0].id);
    });

    it("a second Apply raises the rule the first one wrote, rather than adding another", async () => {
      const first = renderCar();
      await solveAndApply(2000);
      const written = ruleUpserts(first.onChange)[0].value;
      first.view.unmount();

      // The working tree now holds the rule the first Apply wrote.
      const { onChange } = renderCar(vi.fn(), { ...tree, savingsRules: [general, written] } as unknown as ClientData);
      expect(screen.getByRole("spinbutton", { name: "Brokerage annual contribution" }))
        .toHaveAttribute("aria-valuenow", "2000");
      await solveAndApply(500);
      expect(ruleUpserts(onChange)).toEqual([
        { kind: "savings-rule-upsert", id: written.id, value: { ...written, annualAmount: 2500 } },
      ]);
    });

    it("the contribution stepper reads and writes the goal rule", () => {
      const { onChange } = renderCar();
      const stepper = screen.getByRole("spinbutton", { name: "Brokerage annual contribution" });
      expect(stepper).toHaveAttribute("aria-valuenow", "0");
      fireEvent.click(screen.getByRole("button", { name: "Increase Brokerage annual contribution" }));
      expect(onChange).toHaveBeenCalledTimes(1);
      const m = onChange.mock.calls[0][0];
      expect(m).toMatchObject({
        kind: "savings-rule-upsert",
        value: { accountId: "brk", annualAmount: 500, startYear: 2026, endYear: 2029 },
      });
      expect(m.id).toMatch(UUID);
      expect(m.value.id).toBe(m.id);
    });
  });

  it("an education goal's 529 rule that runs past the goal is still its contribution (prod shape)", async () => {
    // Prod goal e3efbe5d: $300/yr into the 529 from 2026 to 2039, goal 2030–2033.
    const edu = { ...goal, startYear: 2030, endYear: 2033 } as Expense;
    const r529 = { id: "r529", accountId: "529-emma", annualAmount: 300, isDeductible: false, startYear: 2026, endYear: 2039 };
    const tree = {
      ...workingTree,
      expenses: [edu],
      accounts: [{ ...workingTree.accounts[0], category: "education_savings", subType: "529" }],
      savingsRules: [r529],
    } as unknown as ClientData;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ additionalAnnual: 1000, reachesTarget: true, targetPct: 1 }),
    }));
    const onChange = vi.fn();
    render(
      <SolverGoalsSection
        baseExpenses={[edu]} workingTree={tree} currentYear={2026}
        clientId="c1" source="base" mutations={[]} onChange={onChange}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: "529 — Emma annual contribution" }))
      .toHaveAttribute("aria-valuenow", "300");
    fireEvent.click(screen.getByRole("button", { name: /solve 529 — emma/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    const upserts = onChange.mock.calls.map((c) => c[0]).filter((m) => m.kind === "savings-rule-upsert");
    expect(upserts).toEqual([
      { kind: "savings-rule-upsert", id: "r529", value: { ...r529, annualAmount: 1300 } },
    ]);
    vi.unstubAllGlobals();
  });

  it("Apply still raises a 529 rule that runs from now to the goal's end", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ additionalAnnual: 1500, reachesTarget: true, targetPct: 1 }),
    }));
    const onChange = vi.fn();
    render(
      <SolverGoalsSection
        baseExpenses={[goal]} workingTree={workingTree} currentYear={2026}
        clientId="c1" source="base" mutations={[]} onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /solve 529 — emma/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({
      kind: "savings-rule-upsert", id: "r1", value: { id: "r1", annualAmount: 7500, endYear: 2035 },
    });
    vi.unstubAllGlobals();
  });
});
