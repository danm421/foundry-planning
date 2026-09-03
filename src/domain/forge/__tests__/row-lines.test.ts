// src/domain/forge/__tests__/row-lines.test.ts
//
// The approval card's detail lines are what the advisor reads before clicking
// Approve. They must be the handful of facts that matter, in plain words, with
// real money formatting — never a raw column dump. Each expectation here is
// the exact line list, so an extra default leaking through (the old failure
// mode: `titlingType: jtwros`, `propertyTaxGrowthSource: custom`) is a red.
import { describe, it, expect } from "vitest";
import {
  editLines,
  fieldLabel,
  formatFieldValue,
  formatMoney,
  formatRate,
  headlineFigure,
  newRowLines,
  ownershipLines,
} from "../row-lines";

/** What accountCreateSchema hands back for a plain brokerage add — every
 *  default populated, exactly as the enrichment sees it. */
const brokerageRow = {
  name: "Schwab Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: "150000",
  basis: "80000",
  rothValue: "0",
  rmdEnabled: false,
  countsTowardAum: false,
  growthSource: "default",
  turnoverPct: "0",
  annualPropertyTax: "0",
  propertyTaxGrowthRate: "0.03",
  propertyTaxGrowthSource: "custom",
  titlingType: "jtwros",
  growthRate: null,
  priorYearEndValue: null,
  modelPortfolioId: null,
  tickerPortfolioId: null,
  parentAccountId: null,
  custodian: "Schwab",
  accountNumberLast4: null,
  activationYear: null,
};

describe("newRowLines — account", () => {
  it("shows the type, the balance, and only the facts that carry information", () => {
    expect(newRowLines("account", brokerageRow)).toEqual([
      "Type: Taxable · Brokerage",
      "Balance: $150,000",
      "Cost basis: $80,000",
      "Custodian: Schwab",
    ]);
  });

  it("never leaks a raw column name", () => {
    for (const line of newRowLines("account", brokerageRow)) {
      expect(line).not.toMatch(/[a-z][A-Z]/); // camelCase
      expect(line).not.toMatch(/: [a-z]+_[a-z]+/); // snake_case enum value
    }
  });

  it("shows a $0 balance rather than hiding it — a zero is a fact", () => {
    expect(newRowLines("account", { ...brokerageRow, value: "0", basis: "0" })).toEqual([
      "Type: Taxable · Brokerage",
      "Balance: $0",
      "Custodian: Schwab",
    ]);
  });

  it("labels a retirement sub-type and a custom growth rate", () => {
    expect(
      newRowLines("account", {
        ...brokerageRow,
        category: "retirement",
        subType: "roth_ira",
        value: "80000",
        basis: "0",
        custodian: null,
        growthSource: "custom",
        growthRate: "0.06",
        rmdEnabled: true,
      }),
    ).toEqual(["Type: Retirement · Roth IRA", "Balance: $80,000", "Growth rate: 6%", "RMDs: Yes"]);
  });

  it("drops an 'other' sub-type and carries the business type", () => {
    expect(
      newRowLines("account", {
        ...brokerageRow,
        category: "business",
        subType: "other",
        businessType: "llc",
        value: "100000",
        basis: "50000",
        custodian: null,
      }),
    ).toEqual(["Type: Business", "Business type: LLC", "Balance: $100,000", "Cost basis: $50,000"]);
  });
});

describe("newRowLines — expense and income", () => {
  const expenseRow = {
    type: "discretionary",
    name: "Annual vacation",
    annualAmount: "12000",
    startYear: 2030,
    endYear: 2040,
    growthRate: "0.03",
    growthSource: "custom",
    paymentMonth: null,
    payShortfallOutOfPocket: false,
    isGoal: false,
    absorbsRemainingCashFlow: false,
    dedicatedAccountIds: [],
  };

  it("collapses start/end into one Years line and formats the amount", () => {
    expect(newRowLines("expense", expenseRow)).toEqual([
      "Type: Discretionary",
      "Annual amount: $12,000",
      "Years: 2030–2040",
      "Growth rate: 3%",
    ]);
  });

  it("says an inflation-tracked expense tracks inflation, and flags a goal", () => {
    expect(
      newRowLines("expense", { ...expenseRow, growthSource: "inflation", isGoal: true, startYear: 2030, endYear: 2030 }),
    ).toEqual([
      "Type: Discretionary",
      "Annual amount: $12,000",
      "Year: 2030",
      "Growth: Tracks inflation",
      "Tracked as a goal: Yes",
    ]);
  });

  it("income shows the owner and the Social Security facts", () => {
    expect(
      newRowLines("income", {
        type: "social_security",
        name: "Jane SS",
        owner: "spouse",
        annualAmount: "0",
        startYear: 2035,
        endYear: 2060,
        growthSource: "inflation",
        claimingAge: 67,
        claimingAgeMonths: 0,
        piaMonthly: "2800",
      }),
    ).toEqual([
      "Type: Social security",
      "Owner: Spouse",
      "Annual amount: $0",
      "Years: 2035–2060",
      "Growth: Tracks inflation",
      "Claiming age: 67",
      "PIA (monthly): $2,800",
    ]);
  });
});

describe("newRowLines — liability", () => {
  const mortgage = {
    name: "Mortgage",
    balance: "200000",
    interestRate: "0",
    monthlyPayment: "0",
    termMonths: 120,
    startYear: 2030,
    startMonth: 1,
    termUnit: "annual",
    balanceAsOfMonth: null,
    balanceAsOfYear: null,
    isInterestDeductible: false,
    forgiveAtTermEnd: false,
  };

  it("shows the four facts that define a loan even when they are zero", () => {
    // A 0% rate or a $0 payment is exactly the gap the advisor should catch.
    expect(newRowLines("liability", mortgage)).toEqual([
      "Balance: $200,000",
      "Interest rate: 0%",
      "Monthly payment: $0",
      "Term: 120 months (10 yrs)",
      "Starts: 2030",
    ]);
  });

  it("formats a rate to at most one decimal and flags deductible interest", () => {
    expect(
      newRowLines("liability", { ...mortgage, interestRate: "0.065", monthlyPayment: "1450.5", isInterestDeductible: true }),
    ).toEqual([
      "Balance: $200,000",
      "Interest rate: 6.5%",
      "Monthly payment: $1,450.50",
      "Term: 120 months (10 yrs)",
      "Starts: 2030",
      "Interest deductible: Yes",
    ]);
  });
});

describe("editLines", () => {
  it("labels the field and formats both sides", () => {
    expect(editLines([{ field: "annualAmount", from: "90000", to: 95000 }])).toEqual([
      "Annual amount: $90,000 → $95,000",
    ]);
  });

  it("hides bookkeeping columns and never prints an id", () => {
    expect(
      editLines([
        { field: "updatedAt", from: "a", to: "b" },
        { field: "owners", from: [], to: [{}] },
        { field: "modelPortfolioId", from: "9c9c9c9c-1", to: "9c9c9c9c-2" },
      ]),
    ).toEqual(["Model portfolio: (changed) → (changed)"]);
  });

  it("de-camelCases a field with no curated label", () => {
    expect(editLines([{ field: "balanceAsOfYear", from: 2024, to: 2025 }])).toEqual([
      "Balance as of year: 2024 → 2025",
    ]);
  });
});

describe("ownershipLines", () => {
  const dan = { kind: "family_member", familyMemberId: "fm-dan", percent: 1 };

  it("names a single owner and drops the percent at 100%", () => {
    expect(ownershipLines(null, [dan], () => "Dan Cooper")).toEqual(["Owner: Dan Cooper"]);
  });

  it("drops a single owner it cannot name — the id it replaced said even less", () => {
    expect(ownershipLines(null, [dan])).toEqual([]);
  });

  it("joins a split with names, falling back to plain words for an unnamed owner", () => {
    const lines = ownershipLines(
      null,
      [
        { ...dan, percent: 0.6 },
        { kind: "entity", entityId: "ent-trust", percent: 0.4 },
      ],
      (o) => (o.familyMemberId ? "Dan Cooper" : undefined),
    );
    expect(lines).toEqual(["Ownership: Dan Cooper 60% · an entity 40%"]);
    expect(lines.join(" ")).not.toContain("ent-trust");
  });

  it("a parent business account wins over owners", () => {
    expect(ownershipLines("biz-1", [dan], () => "Dan Cooper")).toEqual([
      "Owned through the parent business account.",
    ]);
  });
});

describe("formatters", () => {
  it("money: whole dollars, cents only when present, sign in front", () => {
    expect(formatMoney(150000)).toBe("$150,000");
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney(-1200)).toBe("-$1,200");
    expect(formatMoney("n/a")).toBe("n/a");
  });

  it("rate: fraction in, percent out, at most one decimal", () => {
    expect(formatRate(0.03)).toBe("3%");
    expect(formatRate("0.0625")).toBe("6.3%");
  });

  it("labels and enum values read as words", () => {
    expect(fieldLabel("propertyTaxGrowthSource")).toBe("Property tax growth source");
    expect(formatFieldValue("subType", "traditional_ira")).toBe("Traditional IRA");
    expect(formatFieldValue("category", "real_estate")).toBe("Real Estate");
    expect(formatFieldValue("titlingType", "jtwros")).toBe("Joint (JTWROS)");
    expect(formatFieldValue("accountNumberLast4", "1234")).toBe("…1234");
    expect(formatFieldValue("rmdEnabled", true)).toBe("Yes");
    expect(formatFieldValue("custodian", null)).toBe("—");
  });
});

describe("headlineFigure", () => {
  it("names the one figure that identifies a row, formatted for prose", () => {
    expect(headlineFigure("account", { value: "150000.00" })).toBe("$150,000");
    expect(headlineFigure("expense", { annualAmount: "12000" })).toBe("$12,000/yr");
    expect(headlineFigure("income", { annualAmount: 95000 })).toBe("$95,000/yr");
    expect(headlineFigure("liability", { balance: "9840.00" })).toBe("$9,840");
  });

  it("reads $0 when the row carries no figure", () => {
    expect(headlineFigure("account", {})).toBe("$0");
    expect(headlineFigure("liability", { balance: null })).toBe("$0");
  });
});
