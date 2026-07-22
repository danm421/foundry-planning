import { describe, it, expect } from "vitest";
import {
  requiredCommitTabs,
  presenceFromPayload,
  type CategoryPresence,
} from "../required-tabs";
import type { ImportPayload } from "../types";

const NOTHING: CategoryPresence = {
  family: false,
  accounts: false,
  incomes: false,
  expenses: false,
  liabilities: false,
  lifePolicies: false,
  wills: false,
  entities: false,
};

function emptyPayload(): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    warnings: [],
  };
}

describe("requiredCommitTabs", () => {
  it("requires nothing extra when no category carries rows", () => {
    expect(requiredCommitTabs(NOTHING)).toEqual(["plan-basics"]);
  });

  it("requires only the categories that carry rows", () => {
    expect(
      requiredCommitTabs({ ...NOTHING, accounts: true, incomes: true }),
    ).toEqual(["plan-basics", "accounts", "incomes"]);
  });

  it("maps the family category to BOTH of its commit tabs", () => {
    expect(requiredCommitTabs({ ...NOTHING, family: true })).toEqual([
      "plan-basics",
      "clients-identity",
      "family-members",
    ]);
  });

  it("maps lifePolicies to the life-insurance commit tab", () => {
    expect(requiredCommitTabs({ ...NOTHING, lifePolicies: true })).toEqual([
      "plan-basics",
      "life-insurance",
    ]);
  });

  it("returns tabs in COMMIT_TABS order regardless of presence order", () => {
    const all = requiredCommitTabs({
      family: true,
      accounts: true,
      incomes: true,
      expenses: true,
      liabilities: true,
      lifePolicies: true,
      wills: true,
      entities: true,
    });
    expect(all).toEqual([
      "plan-basics",
      "clients-identity",
      "family-members",
      "accounts",
      "incomes",
      "expenses",
      "liabilities",
      "life-insurance",
      "wills",
      "entities",
    ]);
  });
});

describe("presenceFromPayload", () => {
  it("reports nothing present for an empty payload", () => {
    expect(presenceFromPayload(emptyPayload())).toEqual(NOTHING);
  });

  it("treats a primary contact alone as family presence", () => {
    const p = emptyPayload();
    p.primary = { firstName: "Ada", lastName: "Okonkwo" } as ImportPayload["primary"];
    expect(presenceFromPayload(p).family).toBe(true);
  });

  it("treats a dependent alone as family presence", () => {
    const p = emptyPayload();
    p.dependents = [{} as ImportPayload["dependents"][number]];
    expect(presenceFromPayload(p).family).toBe(true);
  });

  it("reproduces the walkthrough import: accounts + incomes + entities only", () => {
    const p = emptyPayload();
    p.accounts = [{} as ImportPayload["accounts"][number]];
    p.incomes = [{} as ImportPayload["incomes"][number]];
    p.entities = [{} as ImportPayload["entities"][number]];
    expect(requiredCommitTabs(presenceFromPayload(p))).toEqual([
      "plan-basics",
      "accounts",
      "incomes",
      "entities",
    ]);
  });
});
