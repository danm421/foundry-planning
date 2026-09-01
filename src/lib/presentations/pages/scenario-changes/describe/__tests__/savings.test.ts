import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";
import type { ScenarioChange } from "@/engine/scenario/types";

const resolve = buildResolveContext({
  accountsById: { a1: { name: "Roth 401(k)", category: "retirement", subType: "roth_401k" } },
  recipientsById: {}, entitiesById: {}, spouseName: "Susan",
  modelPortfoliosById: {}, baseAllocationsById: {},
});
const ctx = { targetNames: { "savings_rule:s1": "401(k) contribution" }, resolve };
const ch = (p: Partial<ScenarioChange>): ScenarioChange => ({
  id: "c", scenarioId: "s", opType: "add", targetKind: "savings_rule",
  targetId: "s1", payload: {}, toggleGroupId: null, orderIndex: 0, ...p,
});

describe("savings_rule describer", () => {
  it("adds with account, amount, roth %, match, window", () => {
    const row = describeChange(ch({ payload: {
      accountId: "a1", annualAmount: 20000, rothPercent: 1,
      employerMatchPct: 0.5, employerMatchCap: 0.06, startYear: 2026, endYear: 2031,
    } }), ctx);
    const d = row.detail.join(" ");
    expect(row.area).toBe("Savings");
    expect(d).toContain("Roth 401(k)");
    expect(d).toContain("$20k/yr");
    expect(d).toContain("100% Roth");
    expect(d).toContain("match 50% to 6%");
    expect(d).toContain("2026");
  });
  it("edit shows account context + field change", () => {
    const row = describeChange(ch({ opType: "edit", payload: { annualAmount: { from: 20000, to: 25000 } } }), ctx);
    expect(row.detail.join(" ")).toContain("$20k → $25k");
  });
});

describe("savings_rule describer — salary basis", () => {
  it("names the basis instead of printing income ids", () => {
    // fmtValue joins a string array with commas, so an unhandled
    // salaryIncomeIds field puts raw UUIDs on a client-facing page — the same
    // leak the [object Object] comment in format.ts documents.
    const row = describeChange(
      ch({
        opType: "edit",
        payload: {
          salaryBasis: { from: "owner", to: "selected" },
          salaryIncomeIds: { from: [], to: ["9f8c1111-2222-4333-8444-555566667777", "1a2b1111-2222-4333-8444-555566667777"] },
        },
      }),
      ctx,
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Account owner's salary");
    expect(d).toContain("Selected salaries");
    expect(d).toContain("2 salaries");
    expect(d).not.toContain("9f8c");
  });

  it("labels a single selected salary in the singular and names the 'all' basis", () => {
    const row = describeChange(
      ch({
        opType: "edit",
        payload: {
          salaryBasis: { from: "selected", to: "all" },
          salaryIncomeIds: { from: ["9f8c1111-2222-4333-8444-555566667777"], to: [] },
        },
      }),
      ctx,
    );
    const d = row.detail.join(" ");
    expect(d).toContain("All salaries");
    expect(d).toContain("1 salary → 0 salaries");
    expect(d).not.toContain("9f8c");
  });
});

describe("savings_rule describer — a no-op id list is not a change", () => {
  const ID_A = "9f8c1111-2222-4333-8444-555566667777";
  const ID_B = "1a2b1111-2222-4333-8444-555566667777";

  it("owner → all drops the untouched 'Salaries used' segment", () => {
    // accumulateSavings skips only on `from === to`, and two arrays are never
    // ===, so THE most common salary-basis edit records an untouched
    // salaryIncomeIds. Rendering it put "0 salaries → 0 salaries" on a
    // client-facing deck beside every real change.
    const row = describeChange(
      ch({
        opType: "edit",
        payload: {
          salaryBasis: { from: "owner", to: "all" },
          salaryIncomeIds: { from: [], to: [] },
        },
      }),
      ctx,
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Account owner's salary → All salaries");
    expect(d).not.toContain("0 salaries");
    expect(d).not.toContain("Salaries used");
  });

  it("keeps the segment when the ids changed but the COUNT did not", () => {
    // The case that kills the naive "drop it when the formatted values match"
    // fix: both sides format as "1 salary", so a formatted compare would hide
    // a real one-for-one swap on a diff page.
    const row = describeChange(
      ch({
        opType: "edit",
        payload: { salaryIncomeIds: { from: [ID_A], to: [ID_B] } },
      }),
      ctx,
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Salaries used: 1 salary → 1 salary");
    expect(d).not.toContain("9f8c");
    expect(d).not.toContain("1a2b");
  });

  it("keeps the segment when the same ids are REORDERED", () => {
    // sortOrder is positional and the engine sums in list order, so a reorder
    // is a real edit even though both sides are "2 salaries".
    const row = describeChange(
      ch({
        opType: "edit",
        payload: { salaryIncomeIds: { from: [ID_A, ID_B], to: [ID_B, ID_A] } },
      }),
      ctx,
    );
    expect(row.detail.join(" ")).toContain("Salaries used: 2 salaries → 2 salaries");
  });

  it("renders a non-array value rather than swallowing it", () => {
    const row = describeChange(
      ch({ opType: "edit", payload: { salaryIncomeIds: { from: null, to: [ID_A] } } }),
      ctx,
    );
    expect(row.detail.join(" ")).toContain("Salaries used: — → 1 salary");
  });

  it("falls back to the spec's edit line when every segment drops out", () => {
    const row = describeChange(
      ch({ opType: "edit", payload: { salaryIncomeIds: { from: [ID_A], to: [ID_A] } } }),
      ctx,
    );
    expect(row.detail.join(" ")).toContain("Adjusts this savings contribution.");
    expect(row.detail.join(" ")).not.toContain("Salaries used");
  });
});
