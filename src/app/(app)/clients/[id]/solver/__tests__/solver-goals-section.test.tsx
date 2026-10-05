// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SolverGoalsSection } from "../solver-goals-section";
import type { ClientData, Expense } from "@/engine/types";

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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ goalId: "goal-1", targetPct: 0.7 });
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

    const renderCar = (onChange = vi.fn()) => {
      render(
        <SolverGoalsSection
          baseExpenses={[car]} workingTree={tree} currentYear={2026}
          clientId="c1" source="base" mutations={[]} onChange={onChange}
        />,
      );
      return onChange;
    };

    it("Apply writes a goal rule ending with the goal, never the household rule", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ additionalAnnual: 2000, reachesTarget: true, targetPct: 1 }),
      }));
      const onChange = renderCar();
      fireEvent.click(screen.getByRole("button", { name: /solve brokerage/i }));
      fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

      const upserts = onChange.mock.calls.map((c) => c[0]).filter((m) => m.kind === "savings-rule-upsert");
      expect(upserts).toEqual([
        {
          kind: "savings-rule-upsert",
          id: "goal-fund-rule-car-brk",
          value: expect.objectContaining({
            id: "goal-fund-rule-car-brk", accountId: "brk", annualAmount: 2000,
            startYear: 2026, endYear: 2029, isDeductible: false,
          }),
        },
      ]);
      vi.unstubAllGlobals();
    });

    it("the contribution stepper reads and writes the goal rule", () => {
      const onChange = renderCar();
      const stepper = screen.getByRole("spinbutton", { name: "Brokerage annual contribution" });
      expect(stepper).toHaveAttribute("aria-valuenow", "0");
      fireEvent.click(screen.getByRole("button", { name: "Increase Brokerage annual contribution" }));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0]).toMatchObject({
        kind: "savings-rule-upsert",
        id: "goal-fund-rule-car-brk",
        value: { accountId: "brk", annualAmount: 500, startYear: 2026, endYear: 2029 },
      });
    });
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
