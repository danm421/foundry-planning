// src/lib/whatif/__tests__/run.test.ts
import { describe, it, expect, vi } from "vitest";
import type { SavingsRule } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import { prepareVariants, runPrepared, type RunDeps, type Solvers } from "../run";
import { WhatIfValidationError } from "../errors";
import { IDS, whatIfTree } from "./fixtures";

/** whatIfTree with the 401(k) savings rule patched. */
function ruleTree(patch: Partial<SavingsRule>) {
  const t = whatIfTree();
  t.savingsRules = t.savingsRules.map((r) => (r.accountId === IDS.k401 ? { ...r, ...patch } : r));
  return t;
}
const solve401k = { kind: "savings" as const, accountId: IDS.k401, targetSuccess: 0.85 };

function deps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    tree: whatIfTree(),
    loadMcPayload: vi.fn(async () => ({}) as MonteCarloPayload),
    monteCarloSuccess: vi.fn(async () => 0.8),
    now: () => 0,
    ...over,
  };
}

describe("prepareVariants", () => {
  it("refuses two variations with the same label", () => {
    expect(() =>
      prepareVariants(whatIfTree(), [], [
        { label: "A", changes: [] },
        { label: "A", changes: [] },
      ]),
    ).toThrow(/both labelled "A"/);
  });

  it("names the variation a bad change belongs to", () => {
    expect(() =>
      prepareVariants(whatIfTree(), [], [
        { label: "Retire 62", changes: [{ type: "retirement_age", person: "client", age: 62 }] },
        { label: "Cut spending", changes: [{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }] },
      ]),
    ).toThrow(/^Variation "Cut spending" — Change 1: expense/);
  });

  it("names shared changes when they are the problem", () => {
    expect(() =>
      prepareVariants(whatIfTree(), [{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }], [
        { label: "A", changes: [] },
      ]),
    ).toThrow(/^Shared changes — Change 1:/);
  });

  it("puts shared changes before each variation's own", () => {
    const [v] = prepareVariants(whatIfTree(), [{ type: "spending_scale", multiplier: 0.9 }], [
      { label: "A", changes: [{ type: "retirement_age", person: "client", age: 62 }] },
    ]);
    expect(v.mutations.map((m) => m.kind)).toEqual(["living-expense-scale", "retirement-age"]);
  });

  it("points a Roth-amount solve at the conversion the variation created", () => {
    const tree = whatIfTree();
    const clientFm = tree.familyMembers!.find((f) => f.role === "client")!.id;
    tree.accounts = tree.accounts.map((a) =>
      a.id === IDS.roth ? { ...a, owners: [{ kind: "family_member" as const, familyMemberId: clientFm, percent: 1 }] } : a,
    );
    const [v] = prepareVariants(
      tree,
      [],
      [
        {
          label: "Roth",
          changes: [
            {
              type: "roth_conversion",
              fromAccountIds: [IDS.k401],
              toAccountId: IDS.roth,
              mode: "fixed_amount",
              amount: 50_000,
              startYear: 2027,
              endYear: 2032,
            },
          ],
          solveFor: { kind: "roth_amount", changeIndex: 0, targetSuccess: 0.85 },
        },
      ],
      () => "00000000-0000-4000-8000-0000000000bb",
    );
    expect(v.rothTechniqueId).toBe("00000000-0000-4000-8000-0000000000bb");
  });

  it("refuses a Roth-amount solve that doesn't point at a fixed_amount conversion", () => {
    expect(() =>
      prepareVariants(whatIfTree(), [], [
        { label: "A", changes: [], solveFor: { kind: "roth_amount", changeIndex: 0, targetSuccess: 0.85 } },
      ]),
    ).toThrow(WhatIfValidationError);
  });

  it("refuses a savings solve on an account with no savings rule", () => {
    expect(() =>
      prepareVariants(whatIfTree(), [], [
        { label: "A", changes: [], solveFor: { kind: "savings", accountId: IDS.brokerage, targetSuccess: 0.85 } },
      ]),
    ).toThrow(/savings rule/);
  });

  // The solve searches a dollar amount; the engine ignores it while a percent
  // of salary or the IRS maximum is in force, so the answer would be inert.
  it("refuses a savings solve on a percent-of-salary rule", () => {
    expect(() =>
      prepareVariants(ruleTree({ annualPercent: 0.1 }), [], [{ label: "A", changes: [], solveFor: solve401k }]),
    ).toThrow(/percent of salary.*savings_amount/);
  });

  it("refuses a savings solve on a contribute-the-maximum rule, and allows it once savings_max turns that off", () => {
    const tree = ruleTree({ contributeMax: true });
    expect(() => prepareVariants(tree, [], [{ label: "A", changes: [], solveFor: solve401k }])).toThrow(
      /IRS maximum.*savings_max.*contributeMax false/,
    );
    const off = { type: "savings_max" as const, accountId: IDS.k401, contributeMax: false };
    expect(() => prepareVariants(tree, [], [{ label: "A", changes: [off], solveFor: solve401k }])).not.toThrow();
  });

  it("marks variations that add an account", () => {
    const [v] = prepareVariants(whatIfTree(), [], [
      { label: "A", changes: [{ type: "add_account", accountType: "taxable", owner: "client", balance: 1 }] },
    ]);
    expect(v.addsAccounts).toBe(true);
  });

  it("hands the growth defaults to shared changes and the variation's own", () => {
    const growthDefaults = { taxable: 0.061, retirement: 0.062, cash: 0.021, realEstate: 0.034 };
    const [v] = prepareVariants(
      whatIfTree(),
      [{ type: "add_account", accountType: "taxable", owner: "client", balance: 1 }],
      [{ label: "A", changes: [{ type: "add_account", accountType: "cash", owner: "client", balance: 1 }] }],
      undefined,
      { growthDefaults },
    );
    const rates = v.mutations.flatMap((m) => (m.kind === "account-upsert" && m.value ? [m.value.growthRate] : []));
    expect(rates).toEqual([0.061, 0.021]);
  });
});

describe("runPrepared", () => {
  const tree = whatIfTree();
  const variants = prepareVariants(tree, [], [
    { label: "Retire 60", changes: [{ type: "retirement_age", person: "client", age: 60 }] },
    { label: "Retire 67", changes: [{ type: "retirement_age", person: "client", age: 67 }] },
  ]);

  it("runs the baseline and every variation deterministically, with deltas against today's plan", async () => {
    const d = deps();
    const out = await runPrepared({ deps: d, variants, includeMonteCarlo: false, budgetMs: 1_000 });
    expect(out.baseline).toMatchObject({ label: "Current plan", status: "done", solve: null });
    expect(out.variants.map((v) => v.status)).toEqual(["done", "done"]);
    expect(out.variants[0].metrics!.successRate).toBeNull();
    expect(out.variants[0].deltas).toHaveProperty("endingPortfolio");
    expect(out.variants[0].metrics!.endingPortfolio).not.toBe(out.variants[1].metrics!.endingPortfolio);
    expect(d.monteCarloSuccess).not.toHaveBeenCalled();
    expect(out.unfinished).toEqual([]);
  });

  it("runs Monte Carlo once per row when asked, with each row's own mutations", async () => {
    const d = deps();
    const out = await runPrepared({ deps: d, variants, includeMonteCarlo: true, budgetMs: 1_000 });
    expect(d.monteCarloSuccess).toHaveBeenCalledTimes(3);
    expect(d.monteCarloSuccess).toHaveBeenNthCalledWith(1, []);
    expect(d.monteCarloSuccess).toHaveBeenNthCalledWith(2, variants[0].mutations);
    expect(out.variants[0].metrics!.successRate).toBe(0.8);
  });

  it("solves max spending on each variation's own working tree", async () => {
    const maxSpending = vi.fn<Solvers["maxSpending"]>(async () => ({
      realAnnualSpend: 180_000, scaleFactor: 0.9, achievedPoS: 0.86, status: "converged" as const,
    }));
    const solved = prepareVariants(tree, [], [
      {
        label: "Retire 60",
        changes: [{ type: "retirement_age", person: "client", age: 60 }],
        solveFor: { kind: "max_spending", targetSuccess: 0.85 },
      },
    ]);
    const out = await runPrepared({
      deps: deps({ solvers: { maxSpending } }),
      variants: solved,
      includeMonteCarlo: false,
      budgetMs: 1_000,
    });
    expect(maxSpending).toHaveBeenCalledWith(expect.objectContaining({ targetPoS: 0.85, searchTrials: 250 }));
    expect(maxSpending.mock.calls[0][0].tree.client.retirementAge).toBe(60);
    expect(out.variants[0].solve).toEqual({
      kind: "max_spending", value: 180_000, status: "converged", achievedSuccess: 0.86,
    });
  });

  it("drops the variation's own retirement age from a retirement-age solve's baseline", async () => {
    const target = vi.fn<Solvers["target"]>(async () => ({
      objective: "pos" as const, status: "converged" as const, solvedValue: 63, achievedPoS: 0.85,
      canonicalPoS: 0.85, iterations: 5, finalProjection: [], seed: 1,
    }));
    const solved = prepareVariants(tree, [], [
      {
        label: "A",
        changes: [
          { type: "retirement_age", person: "client", age: 60 },
          { type: "spending_scale", multiplier: 0.9 },
        ],
        solveFor: { kind: "retirement_age", person: "client", targetSuccess: 0.85 },
      },
    ]);
    await runPrepared({ deps: deps({ solvers: { target } }), variants: solved, includeMonteCarlo: false, budgetMs: 1_000 });
    const args = target.mock.calls[0][0];
    expect(args.baselineMutations.map((m) => m.kind)).toEqual(["living-expense-scale"]);
    expect(args.target).toEqual({ kind: "retirement-age", person: "client" });
  });

  it("keeps a savings_amount's percent-clear in a savings solve's baseline, dropping only the amount", async () => {
    const target = vi.fn<Solvers["target"]>(async () => ({
      objective: "pos" as const, status: "converged" as const, solvedValue: 12_000, achievedPoS: 0.85,
      canonicalPoS: 0.85, iterations: 5, finalProjection: [], seed: 1,
    }));
    const percentTree = ruleTree({ annualPercent: 0.1 });
    const solved = prepareVariants(percentTree, [], [
      {
        label: "A",
        changes: [{ type: "savings_amount", accountId: IDS.k401, annualAmount: 10_000 }],
        solveFor: solve401k,
      },
    ]);
    await runPrepared({
      deps: deps({ tree: percentTree, solvers: { target } }),
      variants: solved,
      includeMonteCarlo: false,
      budgetMs: 1_000,
    });
    const args = target.mock.calls[0][0];
    expect(args.baselineMutations).toEqual([{ kind: "savings-annual-percent", accountId: IDS.k401, percent: null }]);
    expect(args.target).toEqual({ kind: "savings-contribution", accountId: IDS.k401 });
  });

  it("sets the claim-age mode to years for a claim-age solve", async () => {
    const ssClaimAge = vi.fn<Solvers["ssClaimAge"]>(() => ({
      objective: "ending-portfolio" as const, status: "converged" as const, solvedValue: 70,
      endingPortfolio: 1, candidates: [], finalProjection: [],
    }));
    const solved = prepareVariants(tree, [], [{ label: "A", changes: [], solveFor: { kind: "ss_claim_age", person: "client" } }]);
    const out = await runPrepared({ deps: deps({ solvers: { ssClaimAge } }), variants: solved, includeMonteCarlo: false, budgetMs: 1_000 });
    const args = ssClaimAge.mock.calls[0][0];
    expect(args.baselineMutations).toContainEqual({ kind: "ss-claim-age-mode", person: "client", mode: "years" });
    expect(out.variants[0].solve).toMatchObject({ value: 70, achievedSuccess: null });
  });

  it("reports one failing variation as failed and still finishes the rest", async () => {
    const maxSpending = vi
      .fn<Solvers["maxSpending"]>()
      .mockRejectedValueOnce(new Error("engine blew up"))
      .mockResolvedValueOnce({ realAnnualSpend: 1, scaleFactor: 1, achievedPoS: 0.85, status: "converged" });
    const solved = prepareVariants(tree, [], [
      { label: "A", changes: [], solveFor: { kind: "max_spending", targetSuccess: 0.85 } },
      { label: "B", changes: [], solveFor: { kind: "max_spending", targetSuccess: 0.85 } },
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runPrepared({ deps: deps({ solvers: { maxSpending } }), variants: solved, includeMonteCarlo: false, budgetMs: 1_000 });
    errorSpy.mockRestore();
    expect(out.variants.map((v) => v.status)).toEqual(["failed", "done"]);
    expect(out.variants[0].error).toBe("Foundry couldn't run this variation.");
  });

  it("stops starting variations once the budget is spent and lists them as unfinished", async () => {
    let t = 0;
    const d = deps({ now: () => t });
    const progress: number[] = [];
    const out = await runPrepared({
      deps: d,
      variants,
      includeMonteCarlo: false,
      budgetMs: 100,
      onProgress: (done) => {
        progress.push(done);
        t += 200;
      },
    });
    expect(out.variants.map((v) => v.label)).toEqual(["Retire 60"]);
    expect(out.unfinished).toEqual(["Retire 67"]);
    expect(progress).toEqual([1]);
  });
});
