// src/domain/forge/__tests__/preview-household-items.test.ts
//
// Approval cards for add_family_member, set_living_expense_items and
// update_client_profile. The living-items card is a dry run of the real merge
// against the live Current row, so the advisor sees each change and the row's
// total before and after; the profile card shows each field old → new.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/clients/living-items-writes", () => ({
  findCurrentLivingExpense: vi.fn(),
  NO_CURRENT_LIVING_ROW: "This plan has no Current Living Expenses row to itemize.",
}));

import { formatProposedWrite, describeProposedWrite } from "../preview";
import { findCurrentLivingExpense } from "@/lib/clients/living-items-writes";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import type { ForgeAuthContext } from "@/domain/forge/state";

const CTX: ForgeAuthContext = { userId: "u1", firmId: "org_1", clientId: "client_1", scenarioId: "base" };

describe("add_family_member card", () => {
  afterEach(() => vi.useRealTimers());

  it("names the child from a first name alone", () => {
    const out = formatProposedWrite({ name: "add_family_member", args: { firstName: "Emma" } });
    expect(out).toEqual({ name: "add_family_member", summary: "Add child “Emma”.", details: [] });
  });

  it("shows the date of birth an age will be stored as", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 12));
    const out = formatProposedWrite({
      name: "add_family_member",
      args: { firstName: "Jack", lastName: "Cooper", relationship: "stepchild", age: 8 },
    });
    expect(out.summary).toBe("Add stepchild “Jack Cooper”.");
    expect(out.details).toEqual(["Date of birth: 2018-01-01 (estimated from age 8)"]);
  });

  it("surfaces a date the save would refuse before the advisor approves", async () => {
    const out = await describeProposedWrite(
      { name: "add_family_member", args: { firstName: "Emma", dateOfBirth: "2018-02-31" } },
      CTX,
    );
    expect(out.summary).toMatch(/real date/);
  });
});

describe("set_living_expense_items card", () => {
  const HOUSING = { id: "i1", name: "Housing", amount: 3200, frequency: "monthly" as const };
  const GROCERIES = { name: "Groceries", amount: 900, frequency: "monthly" as const };

  beforeEach(() => {
    vi.mocked(findCurrentLivingExpense).mockResolvedValue({
      id: "exp-cur",
      name: "Current Living Expenses",
      annualAmount: "38400",
      livingItems: [HOUSING],
    } as never);
  });

  it("lists the typed items without a database", () => {
    const out = formatProposedWrite({ name: "set_living_expense_items", args: { items: [GROCERIES] } });
    expect(out.summary).toBe("Add 1 item to “Current Living Expenses”.");
    expect(out.details).toEqual(["Groceries: $900/mo"]);
  });

  it("shows each change against the live row and the total before and after", async () => {
    const out = await describeProposedWrite(
      {
        name: "set_living_expense_items",
        args: { items: [GROCERIES, { name: "housing", amount: 3500, frequency: "monthly" }] },
      },
      CTX,
    );
    expect(findCurrentLivingExpense).toHaveBeenCalledWith("client_1");
    expect(out.summary).toBe("Add 2 items to “Current Living Expenses”.");
    expect(out.details).toEqual([
      "Housing: $3,200/mo → $3,500/mo",
      "Add Groceries: $900/mo",
      "Total: $38,400/yr → $52,800/yr",
    ]);
    // The total was already the items' sum — nothing typed is lost.
    expect(out.warning).toBeUndefined();
  });

  it("warns when the items would replace a total typed on the row", async () => {
    vi.mocked(findCurrentLivingExpense).mockResolvedValue({
      id: "exp-cur",
      name: "Current Living Expenses",
      annualAmount: "200000",
      livingItems: null,
    } as never);
    const out = await describeProposedWrite(
      { name: "set_living_expense_items", args: { items: [GROCERIES] } },
      CTX,
    );
    expect(out.warning).toBe(
      "Approving replaces the $200,000/yr total set on this row with the items' sum, $10,800/yr.",
    );
  });

  it("does not warn when the items add up to the typed total", async () => {
    vi.mocked(findCurrentLivingExpense).mockResolvedValue({
      id: "exp-cur",
      name: "Current Living Expenses",
      annualAmount: "10800",
      livingItems: null,
    } as never);
    const out = await describeProposedWrite(
      { name: "set_living_expense_items", args: { items: [GROCERIES] } },
      CTX,
    );
    expect(out.warning).toBeUndefined();
  });

  it("names the row as the advisor renamed it and lists what a replace drops", async () => {
    vi.mocked(findCurrentLivingExpense).mockResolvedValue({
      id: "exp-cur",
      name: "My Spending",
      annualAmount: "38400",
      livingItems: [HOUSING],
    } as never);
    const out = await describeProposedWrite(
      { name: "set_living_expense_items", args: { items: [GROCERIES], mode: "replace" } },
      CTX,
    );
    expect(out.summary).toBe("Replace the items on “My Spending” with 1 item.");
    expect(out.details).toEqual([
      "Add Groceries: $900/mo",
      "Remove Housing: $3,200/mo",
      "Total: $38,400/yr → $10,800/yr",
    ]);
  });

  it("says so when the plan has no Current Living Expenses row", async () => {
    vi.mocked(findCurrentLivingExpense).mockResolvedValue(null);
    const out = await describeProposedWrite(
      { name: "set_living_expense_items", args: { items: [GROCERIES] } },
      CTX,
    );
    expect(out.summary).toBe("This plan has no Current Living Expenses row to itemize.");
  });
});

describe("update_client_profile card", () => {
  const tree = (client: Record<string, unknown>) =>
    ({ effectiveTree: { client } }) as unknown as Awaited<ReturnType<typeof loadEffectiveTree>>;
  const COUPLE = {
    firstName: "Tom",
    dateOfBirth: "1961-05-01",
    retirementAge: 65,
    spouseName: "Ann",
    spouseDob: "1963-02-10",
    spouseRetirementAge: 64,
  };

  it("lists the fields without a database", () => {
    const out = formatProposedWrite({ name: "update_client_profile", args: { retirementAge: 67, retirementMonth: 6 } });
    expect(out.summary).toBe("Update the household profile.");
    expect(out.details).toEqual(["Client's retirement age: 67", "Client's retirement month: June"]);
  });

  it("shows each change old → new under the people's names, and flags the plan end year", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue(tree(COUPLE));
    const out = await describeProposedWrite(
      {
        name: "update_client_profile",
        args: { retirementAge: 67, spouseDob: "1963-02-11", spouseRetirementMonth: 7 },
      },
      CTX,
    );
    expect(loadEffectiveTree).toHaveBeenCalledWith("client_1", "org_1", "base", {});
    expect(out.details).toEqual([
      "Tom's retirement age: 65 → 67",
      "Ann's date of birth: 1963-02-10 → 1963-02-11",
      "Ann's retirement month: January → July",
      "The plan's end year is recalculated from the new date of birth.",
    ]);
  });

  it("refuses a co-client change on a household with no co-client", async () => {
    vi.mocked(loadEffectiveTree).mockResolvedValue(tree({ firstName: "Tom", retirementAge: 65 }));
    const out = await describeProposedWrite(
      { name: "update_client_profile", args: { spouseRetirementAge: 63 } },
      CTX,
    );
    expect(out.summary).toBe("This household has no co-client to update.");
  });

  it("surfaces an impossible date before the advisor approves", async () => {
    const out = await describeProposedWrite(
      { name: "update_client_profile", args: { dateOfBirth: "1961-02-30" } },
      CTX,
    );
    expect(out.summary).toMatch(/real date/);
  });
});
