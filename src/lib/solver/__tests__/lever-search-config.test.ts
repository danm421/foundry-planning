import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import {
  leverSearchConfig,
  buildLeverMutation,
  SAVINGS_HARD_CAP,
  SAVINGS_ZERO_DEFAULT_HI,
  SAVINGS_SOURCE_MULTIPLIER,
} from "../lever-search-config";
import { applyMutations } from "../apply-mutations";

// The solver excludes self-funding savings rules by their fundFromExpenseReduction
// flag, not by a specific account id — any stable id works for this fixture.
const SYNTHETIC_SAVINGS_ACCOUNT_ID = "hypothetical-additional-savings";

const emptyTree = {
  client: {},
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {},
  giftEvents: [],
} as unknown as ClientData;

describe("leverSearchConfig", () => {
  it("retirement-age: range 50-80 step 1 d=+1", () => {
    expect(
      leverSearchConfig({ kind: "retirement-age", person: "client" }, emptyTree),
    ).toEqual({ lo: 50, hi: 80, step: 1, direction: 1 });
  });

  it("living-expense-scale searches dollars: lo 0, descending, $5k step, closest", () => {
    const cfg = leverSearchConfig({ kind: "living-expense-scale" }, emptyTree);
    expect(cfg.lo).toBe(0);
    expect(cfg.direction).toBe(-1);
    expect(cfg.step).toBe(5000);
    expect(cfg.tolerance).toBe(0);
    expect(cfg.selection).toBe("closest");
    expect(cfg.hi).toBeGreaterThanOrEqual(300_000);
    expect(cfg.hi).toBeLessThanOrEqual(3_000_000);
  });

  it("living-expense-scale ceiling rises above the 300k floor for a resource-rich tree", () => {
    // assets 5M → income + 0.1*assets = 500k → estimate drives hi past the floor.
    const richTree = {
      ...emptyTree,
      accounts: [{ value: 5_000_000 }],
    } as unknown as ClientData;
    const cfg = leverSearchConfig({ kind: "living-expense-scale" }, richTree);
    expect(cfg.hi).toBe(500_000);
  });

  it("ss-claim-age: range 62-70 step 1 d=+1", () => {
    expect(
      leverSearchConfig({ kind: "ss-claim-age", person: "spouse" }, emptyTree),
    ).toEqual({ lo: 62, hi: 70, step: 1, direction: 1 });
  });

  it("savings-contribution: hi = source × multiplier, capped at hard cap", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 5_000, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg).toEqual({
      lo: 0,
      hi: 5_000 * SAVINGS_SOURCE_MULTIPLIER,
      step: 1000,
      direction: 1,
    });
  });

  it("savings-contribution: hi caps at SAVINGS_HARD_CAP when source × multiplier exceeds it", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 50_000, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg.hi).toBe(SAVINGS_HARD_CAP);
  });

  it("savings-contribution: source=0 returns SAVINGS_ZERO_DEFAULT_HI", () => {
    const tree = {
      ...emptyTree,
      savingsRules: [
        { id: "r1", accountId: "a1", annualAmount: 0, startYear: 2020, endYear: 2040 },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "a1" },
      tree,
    );
    expect(cfg.hi).toBe(SAVINGS_ZERO_DEFAULT_HI);
  });

  it("savings-contribution: account not in tree returns SAVINGS_ZERO_DEFAULT_HI", () => {
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: "missing" },
      emptyTree,
    );
    expect(cfg.hi).toBe(SAVINGS_ZERO_DEFAULT_HI);
  });

  it("self-funding rule: widens hi off living expense rather than the zero default", () => {
    const tree = {
      ...emptyTree,
      expenses: [
        { id: "e1", type: "living", name: "Living", annualAmount: 80_000, startYear: 2026, endYear: 2055, growthRate: 0.03 },
        { id: "e2", type: "insurance", name: "Ins", annualAmount: 200_000, startYear: 2026, endYear: 2055, growthRate: 0 },
      ],
      savingsRules: [
        {
          id: "r-synth",
          accountId: SYNTHETIC_SAVINGS_ACCOUNT_ID,
          annualAmount: 0,
          fundFromExpenseReduction: true,
          startYear: 2026,
          endYear: 2040,
        },
      ],
    } as unknown as ClientData;
    const cfg = leverSearchConfig(
      { kind: "savings-contribution", accountId: SYNTHETIC_SAVINGS_ACCOUNT_ID },
      tree,
    );
    // Off the living expense (not the $200k insurance row), capped at the hard cap.
    expect(cfg.hi).toBeGreaterThanOrEqual(80_000);
    expect(cfg.hi).toBeLessThanOrEqual(SAVINGS_HARD_CAP);
    expect(cfg.hi).toBeGreaterThan(SAVINGS_ZERO_DEFAULT_HI);
    expect(cfg.lo).toBe(0);
    expect(cfg.direction).toBe(1);
  });
});

describe("buildLeverMutation", () => {
  it("retirement-age", () => {
    expect(buildLeverMutation({ kind: "retirement-age", person: "client" }, 67, emptyTree)).toEqual({
      kind: "retirement-age",
      person: "client",
      age: 67,
    });
  });

  it("living-expense-scale builds a living-expense-amount mutation in dollars", () => {
    expect(buildLeverMutation({ kind: "living-expense-scale" }, 84_000, emptyTree)).toEqual({
      kind: "living-expense-amount",
      amount: 84_000,
    });
  });

  it("ss-claim-age", () => {
    expect(buildLeverMutation({ kind: "ss-claim-age", person: "spouse" }, 68, emptyTree)).toEqual({
      kind: "ss-claim-age",
      person: "spouse",
      age: 68,
    });
  });

  it("savings-contribution", () => {
    expect(
      buildLeverMutation({ kind: "savings-contribution", accountId: "a1" }, 25_000, emptyTree),
    ).toEqual({
      kind: "savings-contribution",
      accountId: "a1",
      annualAmount: 25_000,
    });
  });
});

describe("roth-conversion-amount target", () => {
  const rc = {
    id: "rc-1",
    name: "Conv",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-trad"],
    conversionType: "fixed_amount" as const,
    fixedAmount: 30000,
    startYear: 2030,
    endYear: 2035,
    indexingRate: 0,
  };

  it("derives a search range from the current fixedAmount", () => {
    const tree = { rothConversions: [rc] } as unknown as import("@/engine/types").ClientData;
    const cfg = leverSearchConfig({ kind: "roth-conversion-amount", techniqueId: "rc-1" }, tree);
    expect(cfg.lo).toBe(0);
    expect(cfg.hi).toBeGreaterThan(30000);
    expect(cfg.step).toBeGreaterThan(0);
  });

  it("buildLeverMutation re-upserts the conversion with the new amount", () => {
    const tree = { rothConversions: [rc] } as unknown as import("@/engine/types").ClientData;
    const m = buildLeverMutation(
      { kind: "roth-conversion-amount", techniqueId: "rc-1" },
      75000,
      tree,
    );
    expect(m.kind).toBe("roth-conversion-upsert");
    if (m.kind === "roth-conversion-upsert") {
      expect(m.id).toBe("rc-1");
      expect(m.value?.fixedAmount).toBe(75000);
    }
  });

  it("is positively directional (more conversion → higher PoS)", () => {
    const tree = { rothConversions: [rc] } as unknown as import("@/engine/types").ClientData;
    const cfg = leverSearchConfig({ kind: "roth-conversion-amount", techniqueId: "rc-1" }, tree);
    expect(cfg.direction).toBe(1);
  });

  it("F4: a conversion added in-session resolves only via the working tree, not the base tree", () => {
    // The base plan has no Roth conversions. The advisor adds one inside the
    // solver workspace, where it lives only as a mutation until saved.
    const baseTree = {
      ...emptyTree,
      rothConversions: [],
    } as unknown as import("@/engine/types").ClientData;
    const target = { kind: "roth-conversion-amount", techniqueId: "rc-new" } as const;
    const addMutation = {
      kind: "roth-conversion-upsert" as const,
      id: "rc-new",
      value: { ...rc, id: "rc-new" },
    };

    // Deriving the lever key from the base tree throws — this is the crash the
    // workspace hit when it passed initialSourceClientData instead of workingTree.
    expect(() => buildLeverMutation(target, 0, baseTree)).toThrow(/no conversion/);

    // workingTree = applyMutations(base, mutations) contains the added conversion,
    // so the key derivation the workspace performs at solve time succeeds.
    const workingTree = applyMutations(baseTree, [addMutation]);
    const m = buildLeverMutation(target, 0, workingTree);
    expect(m.kind).toBe("roth-conversion-upsert");
    if (m.kind === "roth-conversion-upsert") expect(m.id).toBe("rc-new");
  });
});
