import { describe, expect, it } from "vitest";
import {
  accountEngineToView,
  clientEngineToView,
  entityEngineToView,
  expenseEngineToView,
  incomeEngineToView,
  liabilityEngineToView,
  planSettingsEngineToView,
  savingsRuleEngineToView,
} from "../view-adapters";
import type {
  Account as EngineAccount,
  ClientInfo,
  Expense as EngineExpense,
  Income as EngineIncome,
  Liability as EngineLiability,
  PlanSettings as EnginePlanSettings,
  SavingsRule as EngineSavingsRule,
  EntitySummary,
} from "@/engine/types";
import { LEGACY_FM_CLIENT } from "../../../engine/ownership";

describe("view-adapters", () => {
  describe("incomeEngineToView", () => {
    it("coerces numerics to strings and preserves view-only metadata", () => {
      const income: EngineIncome = {
        id: "i1",
        type: "salary",
        name: "Job",
        annualAmount: 100_000,
        startYear: 2025,
        endYear: 2040,
        growthRate: 0.03,
        owner: "client",
        startYearRef: "plan_start",
        endYearRef: "client_retirement",
        growthSource: "custom",
        piaMonthly: 2500,
        claimingAgeMonths: 6,
      };
      const view = incomeEngineToView(income);
      expect(view.annualAmount).toBe("100000");
      expect(view.growthRate).toBe("0.03");
      expect(view.startYearRef).toBe("plan_start");
      expect(view.endYearRef).toBe("client_retirement");
      expect(view.growthSource).toBe("custom");
      expect(view.piaMonthly).toBe("2500");
      expect(view.claimingAgeMonths).toBe(6);
    });

    // REGRESSION GUARD. `claimingAgeMode` decides whether the other two claim-age
    // columns are read at all, and dropping it here is invisible: the surfaces
    // fed by this adapter (Details → Inflows & Outflows, the Guided Walkthrough's
    // cash-flow step) rendered an FRA row as an explicit "67y 0mo" and opened
    // `SocialSecurityDialog` on "Specific Age", which then saved that back —
    // converting the row off FRA on a no-op Save.
    it("carries claimingAgeMode with the rest of the claim age", () => {
      const income: EngineIncome = {
        id: "ss1",
        type: "social_security",
        name: "Social Security",
        annualAmount: 0,
        startYear: 2025,
        endYear: 2099,
        growthRate: 0.02,
        owner: "client",
        claimingAge: 67,
        claimingAgeMode: "fra",
        ssBenefitMode: "pia_at_fra",
      };
      expect(incomeEngineToView(income).claimingAgeMode).toBe("fra");
    });

    it("nullifies absent optional fields", () => {
      const income: EngineIncome = {
        id: "i2",
        type: "other",
        name: "X",
        annualAmount: 0,
        startYear: 2025,
        endYear: 2030,
        growthRate: 0,
        owner: "client",
      };
      const view = incomeEngineToView(income);
      expect(view.startYearRef).toBeNull();
      expect(view.endYearRef).toBeNull();
      expect(view.growthSource).toBeNull();
      expect(view.piaMonthly).toBeNull();
      expect(view.claimingAge).toBeNull();
      expect(view.ownerAccountId).toBeNull();
    });

    it("preserves ownerAccountId for business-as-asset incomes", () => {
      const income: EngineIncome = {
        id: "i3",
        type: "business",
        name: "Acme draw",
        annualAmount: 80_000,
        startYear: 2025,
        endYear: 2040,
        growthRate: 0.02,
        owner: "client",
        ownerAccountId: "acct-acme",
      };
      const view = incomeEngineToView(income);
      expect(view.ownerAccountId).toBe("acct-acme");
      expect(view.ownerEntityId).toBeNull();
    });

    // REGRESSION GUARD. `paymentMonth` is the "Paid in" month the income dialog
    // writes. Dropping it here is invisible AND destructive: the dialog hydrates
    // from this view, so a row saved as "March" reopens on "Monthly", and
    // `incomes-writes.ts` writes the column whenever the key is present — so a
    // no-op Save on that reopened row nulls the month the advisor chose.
    it("carries paymentMonth so the Paid in select hydrates on edit", () => {
      const income: EngineIncome = {
        id: "i4",
        type: "other",
        name: "Bonus",
        annualAmount: 20_000,
        startYear: 2025,
        endYear: 2030,
        growthRate: 0,
        owner: "client",
        paymentMonth: 3,
      };
      expect(incomeEngineToView(income).paymentMonth).toBe(3);
      // Absent means "spread evenly across all twelve months", carried as null
      // rather than dropped. This is FILE CONSISTENCY, not a write-path guard:
      // `incomes-writes.ts:209` does skip an `undefined`, but the dialog
      // re-applies its own `?? null` before submitting, so the payload is null
      // either way. Every sibling field here normalises the same way.
      expect(incomeEngineToView({ ...income, paymentMonth: undefined }).paymentMonth).toBeNull();
    });
  });

  describe("incomeEngineToView linkedPropertyId", () => {
    it("carries linkedPropertyId through", () => {
      const inc = { id: "i", type: "other", name: "Rent", annualAmount: 1, startYear: 2026, endYear: 2030, growthRate: 0, owner: "joint", linkedPropertyId: "re-1" } as EngineIncome;
      expect(incomeEngineToView(inc).linkedPropertyId).toBe("re-1");
    });
  });

  describe("expenseEngineToView", () => {
    it("coerces numerics and preserves metadata", () => {
      const expense: EngineExpense = {
        id: "e1",
        type: "living",
        name: "Mortgage",
        annualAmount: 24000,
        startYear: 2025,
        endYear: 2055,
        growthRate: 0.025,
        startYearRef: "plan_start",
        endYearRef: "plan_end",
        growthSource: "inflation",
        deductionType: "property_tax",
      };
      const view = expenseEngineToView(expense);
      expect(view.annualAmount).toBe("24000");
      expect(view.growthRate).toBe("0.025");
      expect(view.startYearRef).toBe("plan_start");
      expect(view.endYearRef).toBe("plan_end");
      expect(view.growthSource).toBe("inflation");
      expect(view.deductionType).toBe("property_tax");
      expect(view.ownerAccountId).toBeNull();
    });

    it("preserves ownerAccountId for business-as-asset expenses", () => {
      const expense: EngineExpense = {
        id: "e2",
        type: "other",
        name: "Acme rent",
        annualAmount: 24_000,
        startYear: 2025,
        endYear: 2055,
        growthRate: 0.02,
        ownerAccountId: "acct-acme",
      };
      const view = expenseEngineToView(expense);
      expect(view.ownerAccountId).toBe("acct-acme");
      expect(view.ownerEntityId).toBeNull();
    });

    // REGRESSION GUARD — the expense half of the same round trip. See the
    // income guard above: without this field the expense dialog reopens a
    // timed row on "Monthly" and saving it nulls the stored month.
    it("carries paymentMonth so the Paid in select hydrates on edit", () => {
      const expense: EngineExpense = {
        id: "e5",
        type: "other",
        name: "Property tax",
        annualAmount: 8_000,
        startYear: 2025,
        endYear: 2055,
        growthRate: 0.02,
        paymentMonth: 11,
      };
      expect(expenseEngineToView(expense).paymentMonth).toBe(11);
      expect(expenseEngineToView({ ...expense, paymentMonth: undefined }).paymentMonth).toBeNull();
    });

    it("round-trips education fields for edit (create→edit round-trip)", () => {
      const expense: EngineExpense = {
        id: "e3",
        type: "education",
        name: "Penn State tuition",
        annualAmount: 40_000,
        startYear: 2030,
        endYear: 2034,
        growthRate: 0.05,
        payShortfallOutOfPocket: true,
        institutionState: "PA",
        institutionName: "Penn State",
        forFamilyMemberId: "fm1",
        dedicatedAccountIds: ["a1", "a2"],
      };
      const view = expenseEngineToView(expense);
      expect(view.payShortfallOutOfPocket).toBe(true);
      expect(view.institutionState).toBe("PA");
      expect(view.institutionName).toBe("Penn State");
      expect(view.forFamilyMemberId).toBe("fm1");
      expect(view.dedicatedAccountIds).toEqual(["a1", "a2"]);
    });

    it("nullifies/defaults absent education fields", () => {
      const expense: EngineExpense = {
        id: "e4",
        type: "education",
        name: "Unspecified education goal",
        annualAmount: 10_000,
        startYear: 2030,
        endYear: 2034,
        growthRate: 0.05,
      };
      const view = expenseEngineToView(expense);
      expect(view.payShortfallOutOfPocket).toBe(false);
      expect(view.institutionState).toBeNull();
      expect(view.institutionName).toBeNull();
      expect(view.forFamilyMemberId).toBeNull();
      expect(view.dedicatedAccountIds).toEqual([]);
    });

    // isGoal is a real persisted column (expenses.is_goal). A form hydrated
    // from this adapter submits every field it renders, so dropping the flag
    // here silently un-goals the row on the next save.
    it("carries isGoal through when the advisor flagged the expense as a goal", () => {
      const expense: EngineExpense = {
        id: "e5",
        type: "other",
        name: "New boat",
        annualAmount: 60_000,
        startYear: 2032,
        endYear: 2032,
        growthRate: 0.03,
        isGoal: true,
      };
      expect(expenseEngineToView(expense).isGoal).toBe(true);
    });

    it("defaults isGoal to false when the engine row omits it", () => {
      const expense: EngineExpense = {
        id: "e6",
        type: "living",
        name: "Groceries",
        annualAmount: 12_000,
        startYear: 2026,
        endYear: 2056,
        growthRate: 0.03,
      };
      expect(expenseEngineToView(expense).isGoal).toBe(false);
    });
  });

  describe("savingsRuleEngineToView", () => {
    it("coerces numerics with null-safe coercion", () => {
      const rule: EngineSavingsRule = {
        id: "s1",
        accountId: "acc1",
        annualAmount: 12000,
        annualPercent: 0.1,
        isDeductible: true,
        startYear: 2025,
        endYear: 2040,
        growthRate: 0.02,
        employerMatchPct: 0.05,
        employerMatchCap: 0.06,
        startYearRef: "plan_start",
        endYearRef: "client_retirement",
        growthSource: "custom",
      };
      const view = savingsRuleEngineToView(rule);
      expect(view.annualAmount).toBe("12000");
      expect(view.annualPercent).toBe("0.1");
      expect(view.growthRate).toBe("0.02");
      expect(view.employerMatchPct).toBe("0.05");
      expect(view.employerMatchCap).toBe("0.06");
      expect(view.employerMatchAmount).toBeNull();
    });

    it("carries salaryBasis and salaryIncomeIds through, defaulting an unset basis to null/[]", () => {
      // Task 5's round-trip bug: this mapping originally dropped both fields
      // entirely, so every rule reopened in the UI silently reset to "owner"
      // on its next save. Pinned at the adapter level, not just via the
      // dialog integration test that first caught it.
      const selected: EngineSavingsRule = {
        id: "s2",
        accountId: "acc1",
        annualAmount: 0,
        isDeductible: false,
        startYear: 2025,
        endYear: 2040,
        salaryBasis: "selected",
        salaryIncomeIds: ["inc-1", "inc-2"],
      };
      const view = savingsRuleEngineToView(selected);
      expect(view.salaryBasis).toBe("selected");
      expect(view.salaryIncomeIds).toEqual(["inc-1", "inc-2"]);

      const unset: EngineSavingsRule = {
        id: "s3",
        accountId: "acc1",
        annualAmount: 0,
        isDeductible: false,
        startYear: 2025,
        endYear: 2040,
      };
      expect(savingsRuleEngineToView(unset).salaryBasis).toBeNull();
      expect(savingsRuleEngineToView(unset).salaryIncomeIds).toEqual([]);
    });
  });

  describe("accountEngineToView", () => {
    it("returns engine-only fields with stringified values", () => {
      const account: EngineAccount = {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        subType: "individual",
        titlingType: "jtwros",
        value: 500_000,
        basis: 250_000,
        growthRate: 0.07,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        isDefaultChecking: false,
      };
      const view = accountEngineToView(account);
      expect(view.value).toBe("500000");
      expect(view.basis).toBe("250000");
      expect(view.growthRate).toBe("0.07");
      expect(view.rmdEnabled).toBe(false);
      expect(view.ownerEntityId).toBeNull();
    });
  });

  describe("liabilityEngineToView", () => {
    it("returns engine-only fields with stringified values", () => {
      const liability: EngineLiability = {
        id: "l1",
        name: "Mortgage",
        balance: 250_000,
        interestRate: 0.04,
        monthlyPayment: 1500,
        startYear: 2020,
        startMonth: 6,
        termMonths: 360,
        extraPayments: [],
        owners: [],
      };
      const view = liabilityEngineToView(liability);
      expect(view.balance).toBe("250000");
      expect(view.interestRate).toBe("0.04");
      expect(view.monthlyPayment).toBe("1500");
      expect(view.balanceAsOfMonth).toBeNull();
      expect(view.balanceAsOfYear).toBeNull();
      expect(view.linkedPropertyId).toBeNull();
      expect(view.isInterestDeductible).toBe(false);
    });
  });

  describe("entityEngineToView", () => {
    it("returns engine-only fields with stringified exemption", () => {
      const entity: EntitySummary = {
        id: "e1",
        includeInPortfolio: true,
        isGrantor: true,
        isIrrevocable: false,
        exemptionConsumed: 100_000,
        grantor: "client",
        entityType: "trust",
        distributionMode: "fixed",
        distributionAmount: 5_000,
      };
      const view = entityEngineToView(entity);
      expect(view.exemptionConsumed).toBe("100000");
      expect(view.grantor).toBe("client");
      expect(view.distributionMode).toBe("fixed");
      expect(view.distributionAmount).toBe(5_000);
    });
  });

  describe("clientEngineToView", () => {
    it("nullifies optional fields and preserves required ones", () => {
      const client: ClientInfo = {
        firstName: "Jane",
        lastName: "Doe",
        dateOfBirth: "1965-03-15",
        retirementAge: 67,
        planEndAge: 95,
        filingStatus: "married_joint",
        spouseName: "John Doe",
        spouseRetirementAge: 65,
      };
      const view = clientEngineToView(client);
      expect(view.firstName).toBe("Jane");
      expect(view.retirementAge).toBe(67);
      expect(view.spouseName).toBe("John Doe");
      expect(view.spouseRetirementAge).toBe(65);
      expect(view.spouseDob).toBeNull();
      expect(view.spouseLifeExpectancy).toBeNull();
      expect(view.lifeExpectancy).toBeNull();
    });
  });

  describe("planSettingsEngineToView", () => {
    it("coerces all numerics to strings", () => {
      const settings: EnginePlanSettings = {
        flatFederalRate: 0.22,
        flatStateRate: 0.05,
        inflationRate: 0.03,
        planStartYear: 2025,
        planEndYear: 2055,
        taxEngineMode: "bracket",
        taxInflationRate: 0.025,
        ssWageGrowthRate: 0.035,
        estateAdminExpenses: 50_000,
        flatStateEstateRate: 0.08,
        outOfHouseholdRate: 0.37,
      };
      const view = planSettingsEngineToView(settings);
      expect(view.flatFederalRate).toBe("0.22");
      expect(view.flatStateRate).toBe("0.05");
      expect(view.inflationRate).toBe("0.03");
      expect(view.planStartYear).toBe(2025);
      expect(view.taxInflationRate).toBe("0.025");
      expect(view.ssWageGrowthRate).toBe("0.035");
      expect(view.estateAdminExpenses).toBe("50000");
      expect(view.flatStateEstateRate).toBe("0.08");
      expect(view.outOfHouseholdRate).toBe("0.37");
    });

    it("nullifies absent rate overrides and zero-defaults estate fields", () => {
      const settings: EnginePlanSettings = {
        flatFederalRate: 0.22,
        flatStateRate: 0.05,
        inflationRate: 0.03,
        planStartYear: 2025,
        planEndYear: 2055,
      };
      const view = planSettingsEngineToView(settings);
      expect(view.taxInflationRate).toBeNull();
      expect(view.ssWageGrowthRate).toBeNull();
      expect(view.outOfHouseholdRate).toBeNull();
      expect(view.estateAdminExpenses).toBe("0");
      expect(view.flatStateEstateRate).toBe("0");
    });
  });
});
