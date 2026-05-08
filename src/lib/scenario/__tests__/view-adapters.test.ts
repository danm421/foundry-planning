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
  });

  describe("accountEngineToView", () => {
    it("returns engine-only fields with stringified values", () => {
      const account: EngineAccount = {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        subType: "individual",
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
        trustSubType: "revocable",
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
