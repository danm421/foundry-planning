import { describe, it, expect } from "vitest";
import {
  requiredCommitTabs,
  presenceFromPayload,
  ALWAYS_REQUIRED_TABS,
  type CategoryPresence,
} from "../required-tabs";
import { emptyImportPayload, type ImportPayload } from "../types";
import { blank, stated } from "../assemble/field";

const NOTHING: CategoryPresence = {
  family: false,
  accounts: false,
  incomes: false,
  expenses: false,
  liabilities: false,
  lifePolicies: false,
  wills: false,
  entities: false,
  goals: false,
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
      goals: false,
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

describe("goals tab requirement", () => {
  it("is NOT required on an import with no goals", () => {
    const presence = presenceFromPayload(emptyImportPayload());
    expect(presence.goals).toBe(false);
    expect(requiredCommitTabs(presence)).not.toContain("goals");
  });

  it("is required once the payload carries a goal", () => {
    const payload = {
      ...emptyImportPayload(),
      goals: { education: [{ id: "edu:x" } as never], homePurchases: [], riskTolerance: blank<string>() },
    };
    const presence = presenceFromPayload(payload);
    expect(presence.goals).toBe(true);
    expect(requiredCommitTabs(presence)).toContain("goals");
  });

  it("is required when only a risk tolerance is stated (no education/home goals)", () => {
    // The common no-goals household: the advisor picks a tolerance in the Goals
    // step but has no education or home-purchase rows. The Goals tab must still
    // be required so commitGoals runs and persists clients.risk_tolerance —
    // otherwise the tolerance is silently dropped and no portfolio is applied.
    const payload = {
      ...emptyImportPayload(),
      goals: { education: [], homePurchases: [], riskTolerance: stated<string>("moderate") },
    };
    const presence = presenceFromPayload(payload);
    expect(presence.goals).toBe(true);
    expect(requiredCommitTabs(presence)).toContain("goals");
  });

  it("never becomes unconditionally required", () => {
    // Guards the open onboarding STEP_COMMIT_TABS regression: a second
    // always-required tab would make more import paths uncommittable.
    expect(ALWAYS_REQUIRED_TABS).toEqual(["plan-basics"]);
  });

  it("commits last, after accounts", () => {
    const all = requiredCommitTabs({
      family: true, accounts: true, incomes: true, expenses: true,
      liabilities: true, lifePolicies: true, wills: true, entities: true, goals: true,
    });
    expect(all[all.length - 1]).toBe("goals");
    expect(all.indexOf("accounts")).toBeLessThan(all.indexOf("goals"));
  });
});
