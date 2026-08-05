import { describe, expect, it } from "vitest";
import {
  isPortalWritableExpense,
  isPortalWritableIncome,
  isPortalWritableSavingsRule,
} from "@/lib/portal/portal-flow-writable";
import type { Expense, Income, SavingsRule } from "@/engine/types";

const income = (over: Partial<Income> = {}) =>
  ({ id: "i1", source: "manual", type: "salary", ...over }) as Income;
const expense = (over: Partial<Expense> = {}) =>
  ({ id: "e1", source: "manual", ...over }) as Expense;

const ACCOUNTS = new Map([
  ["taxable-1", { category: "taxable", isDefaultChecking: false, parentAccountId: null }],
  ["cash-bucket", { category: "cash", isDefaultChecking: true, parentAccountId: null }],
  ["biz-sub", { category: "taxable", isDefaultChecking: false, parentAccountId: "biz-1" }],
  ["529-1", { category: "education_savings", isDefaultChecking: false, parentAccountId: null }],
]);
const rule = (over: Partial<SavingsRule> = {}) =>
  ({ id: "s1", accountId: "taxable-1", annualAmount: 500, ...over }) as SavingsRule;

describe("isPortalWritableIncome", () => {
  it("admits an ordinary manual income", () => {
    expect(isPortalWritableIncome(income())).toBe(true);
  });
  it("refuses a synthesized policy income — it has no DB row to write", () => {
    expect(isPortalWritableIncome(income({ source: "policy" }))).toBe(false);
  });
  it("refuses social security — claim strategy is an advisor lever", () => {
    expect(isPortalWritableIncome(income({ type: "social_security" }))).toBe(false);
  });
  it("refuses entity-owned income", () => {
    expect(isPortalWritableIncome(income({ ownerEntityId: "ent-1" }))).toBe(false);
  });
  it("refuses business-account-owned income", () => {
    expect(isPortalWritableIncome(income({ ownerAccountId: "biz-1" }))).toBe(false);
  });
});

describe("isPortalWritableExpense", () => {
  it("admits an ordinary manual expense", () => {
    expect(isPortalWritableExpense(expense())).toBe(true);
  });
  it("refuses a synthesized policy premium", () => {
    expect(isPortalWritableExpense(expense({ source: "policy" }))).toBe(false);
  });
  it("refuses entity-owned expense", () => {
    expect(isPortalWritableExpense(expense({ ownerEntityId: "ent-1" }))).toBe(false);
  });
});

describe("isPortalWritableSavingsRule", () => {
  it("admits a flat-dollar rule funding a portal-visible account", () => {
    expect(isPortalWritableSavingsRule(rule(), ACCOUNTS)).toBe(true);
  });
  it("refuses an IRS-max rule — the client would type a figure the engine overrules", () => {
    expect(isPortalWritableSavingsRule(rule({ contributeMax: true }), ACCOUNTS)).toBe(false);
  });
  it("refuses a percent-of-pay rule", () => {
    expect(isPortalWritableSavingsRule(rule({ annualPercent: 0.2 }), ACCOUNTS)).toBe(false);
  });
  it("refuses a rule carrying a custom schedule", () => {
    expect(isPortalWritableSavingsRule(rule({ scheduleOverrides: { 2030: 1000 } }), ACCOUNTS)).toBe(false);
  });
  it("refuses a rule funding an engine cash bucket", () => {
    expect(isPortalWritableSavingsRule(rule({ accountId: "cash-bucket" }), ACCOUNTS)).toBe(false);
  });
  it("refuses a rule funding a business sub-account", () => {
    expect(isPortalWritableSavingsRule(rule({ accountId: "biz-sub" }), ACCOUNTS)).toBe(false);
  });
  it("refuses a rule funding a 529 — education_savings is not portal-visible", () => {
    expect(isPortalWritableSavingsRule(rule({ accountId: "529-1" }), ACCOUNTS)).toBe(false);
  });
  it("refuses a rule whose account is missing from the map", () => {
    expect(isPortalWritableSavingsRule(rule({ accountId: "gone" }), ACCOUNTS)).toBe(false);
  });
});
