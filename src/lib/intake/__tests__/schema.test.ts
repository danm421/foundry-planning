import { describe, it, expect } from "vitest";
import {
  intakeSubmitSchema,
  intakeSubmitSchemaFor,
  intakeDraftSchema,
  maritalToFilingStatus,
  pruneIntakeBlankRows,
} from "../schema";

describe("intake schema", () => {
  it("accepts a complete submission", () => {
    const ok = intakeSubmitSchema.safeParse({
      family: {
        primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20", maritalStatus: "married" },
        spouse: { firstName: "Susan", lastName: "Sample", dateOfBirth: "1979-01-01", maritalStatus: "married" },
        stateOfResidence: "PA",
        children: [{ firstName: "Caroline", lastName: "Sample", dateOfBirth: "2015-05-05" }],
      },
      accounts: [{ name: "401k", category: "retirement", value: 1200000 }],
      income: [{ name: "Cooper's Salary", type: "salary", annualAmount: 200000, owner: "client" }],
      property: [{ name: "Home", kind: "real_estate", value: 650000 }],
      goals: { clientRetirementAge: 65, spouseRetirementAge: 61, annualRetirementExpenses: 145000 },
      meta: { completedSections: ["family", "assets", "goals"] },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects submission missing primary DOB", () => {
    const bad = intakeSubmitSchema.safeParse({ family: { primary: { firstName: "A", lastName: "B" }, children: [] } });
    expect(bad.success).toBe(false);
  });

  it("draft schema tolerates a half-filled payload", () => {
    const draft = intakeDraftSchema.safeParse({ family: { children: [] }, accounts: [] });
    expect(draft.success).toBe(true);
  });

  it("draft schema accepts freshly-added blank rows (the autosave path)", () => {
    // A blank row carries name "" / amount 0 — `.partial()` of the strict
    // schema used to reject "" against min(1), 422-ing every autosave.
    const draft = intakeDraftSchema.safeParse({
      family: {
        primary: { firstName: "", lastName: "", dateOfBirth: "" },
        spouse: { firstName: "", lastName: "", dateOfBirth: "" },
        children: [{ firstName: "", lastName: "", dateOfBirth: "" }],
      },
      accounts: [{ name: "", category: "taxable", value: 0 }],
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      property: [{ name: "", kind: "real_estate", value: 0 }],
      // mid-typing a retirement age ("4") is below the strict min(40) — draft
      // must still persist it.
      goals: { clientRetirementAge: 4 },
    });
    expect(draft.success).toBe(true);
  });

  it("prunes fully-blank optional rows but keeps named ones", () => {
    const pruned = pruneIntakeBlankRows({
      family: {
        primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" },
        children: [
          { firstName: "", lastName: "", dateOfBirth: "" },
          { firstName: "Caroline", dateOfBirth: "2015-05-05" },
        ],
      },
      accounts: [
        { name: "", category: "taxable", value: 0 },
        { name: "401k", category: "retirement", value: 1000 },
      ],
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      property: [],
    }) as Record<string, { length?: number } | undefined> & {
      accounts: unknown[];
      income: unknown[];
      family: { children: unknown[] };
    };

    expect(pruned.accounts).toHaveLength(1);
    expect(pruned.income).toHaveLength(0);
    expect(pruned.family.children).toHaveLength(1);
  });

  it("a pruned + completed payload passes strict submit validation", () => {
    const raw = {
      family: {
        primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20", maritalStatus: "single" },
        children: [],
      },
      // user added an income row via the wizard, then skipped it blank
      income: [{ name: "", type: "salary", annualAmount: 0, owner: "client" }],
      accounts: [],
      property: [],
    };
    expect(intakeSubmitSchema.safeParse(raw).success).toBe(false); // blank row blocks it
    expect(intakeSubmitSchema.safeParse(pruneIntakeBlankRows(raw)).success).toBe(true);
  });

  // ── Property: basis / owner / taxes / insurance / mortgage ───────────────

  it("accepts a fully-specified property with a mortgage", () => {
    const ok = intakeSubmitSchema.safeParse({
      family: {
        primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" },
        children: [],
      },
      property: [
        {
          name: "Home",
          kind: "real_estate",
          value: 850000,
          basis: 500000,
          owner: "joint",
          annualPropertyTax: 12000,
          annualInsurance: 2400,
          mortgage: {
            balance: 420000,
            yearsRemaining: 22,
            interestRatePct: 6.5,
            monthlyPayment: 2650,
          },
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("defaults a property owner so pre-field payloads still re-parse on apply", () => {
    // Apply re-parses the STORED payload; a property saved before `owner`
    // existed must not throw there.
    const parsed = intakeSubmitSchema.parse({
      family: {
        primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" },
        children: [],
      },
      property: [{ name: "Home", kind: "real_estate", value: 650000 }],
    });
    expect(parsed.property[0].owner).toBe("client");
  });

  it("accepts a mortgage the client only partly remembers", () => {
    // Checking the box must never block submit — the advisor chases the rest.
    const ok = intakeSubmitSchema.safeParse({
      family: {
        primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" },
        children: [],
      },
      property: [
        { name: "Home", kind: "real_estate", value: 850000, mortgage: { balance: 420000 } },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("keeps a property row whose only content is a mortgage balance", () => {
    // name + value are blank, so the old two-field blankness test would have
    // pruned this row and silently discarded the balance.
    const pruned = pruneIntakeBlankRows({
      property: [
        { name: "", kind: "real_estate", value: 0, mortgage: { balance: 420000 } },
        { name: "", kind: "real_estate", value: 0, annualPropertyTax: 12000 },
        { name: "", kind: "real_estate", value: 0, mortgage: {} },
        { name: "", kind: "real_estate", value: 0 },
      ],
    }) as { property: unknown[] };

    // The balance row and the property-tax row survive; ticking the box with
    // nothing typed is not content, so the last two go.
    expect(pruned.property).toHaveLength(2);
  });

  it("draft schema tolerates a half-typed mortgage", () => {
    const draft = intakeDraftSchema.safeParse({
      property: [{ name: "", kind: "real_estate", value: 0, mortgage: { interestRatePct: 6 } }],
    });
    expect(draft.success).toBe(true);
  });

  it("caps array lengths", () => {
    const tooMany = intakeSubmitSchema.safeParse({
      family: { primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" }, children: [] },
      accounts: Array.from({ length: 51 }, () => ({ name: "x", category: "cash", value: 1 })),
    });
    expect(tooMany.success).toBe(false);
  });

  it("maps marital status to filing status", () => {
    expect(maritalToFilingStatus("married")).toBe("married_joint");
    expect(maritalToFilingStatus("single")).toBe("single");
    expect(maritalToFilingStatus("widowed")).toBe("single");
  });
});

// ── Goals: funded goals + "On your radar" ────────────────────────────────────

const MIN_FAMILY = {
  primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20" },
  children: [],
};

/** Strict-parse a goals slice on an otherwise-minimal payload. */
function submitGoals(goals: unknown) {
  return intakeSubmitSchema.safeParse({ family: MIN_FAMILY, goals });
}

describe("intake goals", () => {
  it("accepts a fully-specified funded goal", () => {
    const ok = submitGoals({
      expenseGoals: [
        {
          name: "Emma's college",
          type: "education",
          amount: 40000,
          startYear: 2034,
          years: 4,
          forWhom: "child:0",
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a beneficiary reference that isn't a structural ref", () => {
    // A NAME used to be legal here. It isn't: a name breaks the moment the
    // client goes back and fixes a spelling, so the schema refuses one.
    const named = submitGoals({
      expenseGoals: [{ name: "College", type: "education", amount: 1, forWhom: "Emma" }],
    });
    expect(named.success).toBe(false);

    for (const ref of ["client", "spouse", "child:0", "child:19"]) {
      expect(
        submitGoals({
          expenseGoals: [{ name: "College", type: "education", amount: 1, forWhom: ref }],
        }).success,
      ).toBe(true);
    }
  });

  it("defaults a goal to one year so a one-time expense needs no duration", () => {
    const ok = submitGoals({
      expenseGoals: [{ name: "Wedding", type: "wedding", amount: 45000 }],
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.goals.expenseGoals[0].years).toBe(1);
  });

  it("rejects a fractional duration", () => {
    const bad = submitGoals({
      expenseGoals: [{ name: "Trip", type: "travel", amount: 20000, years: 2.5 }],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a goal type that isn't on offer", () => {
    const bad = submitGoals({
      expenseGoals: [{ name: "Yacht", type: "boat", amount: 1 }],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects an unknown discussion topic on submit", () => {
    expect(submitGoals({ topics: ["charitable"] }).success).toBe(true);
    expect(submitGoals({ topics: ["astrology"] }).success).toBe(false);
  });

  it("defaults both goal lists to empty when the step is skipped entirely", () => {
    const ok = intakeSubmitSchema.safeParse({ family: MIN_FAMILY });
    expect(ok.success).toBe(true);
    expect(ok.data?.goals.expenseGoals).toEqual([]);
    expect(ok.data?.goals.topics).toEqual([]);
  });

  it("draft schema accepts a freshly-added blank goal card", () => {
    const draft = intakeDraftSchema.safeParse({
      goals: { expenseGoals: [{ name: "", type: "other", amount: 0, years: 1 }] },
    });
    expect(draft.success).toBe(true);
  });

  it("draft schema round-trips a topic the current list no longer has", () => {
    // A draft saved against an older revision must autosave, not 422 — the enum
    // is enforced on submit, which is where an unknown topic should surface.
    const draft = intakeDraftSchema.safeParse({ goals: { topics: ["retired_early"] } });
    expect(draft.success).toBe(true);
  });

  it("prunes an abandoned goal card but keeps one with any content", () => {
    const pruned = pruneIntakeBlankRows({
      goals: {
        clientRetirementAge: 65,
        expenseGoals: [
          { name: "", type: "other", amount: 0, years: 1 },
          { name: "Wedding", type: "wedding", amount: 0, years: 1 },
          { name: "", type: "other", amount: 30000, years: 1 },
        ],
      },
    }) as { goals: { clientRetirementAge: number; expenseGoals: { name: string }[] } };

    expect(pruned.goals.expenseGoals).toHaveLength(2);
    expect(pruned.goals.expenseGoals.map((g) => g.name)).toEqual(["Wedding", ""]);
    // Pruning rebuilds the goals object; the scalars on it must survive.
    expect(pruned.goals.clientRetirementAge).toBe(65);
  });

  it("a pruned payload with an abandoned goal card passes strict submit", () => {
    const pruned = pruneIntakeBlankRows({
      family: MIN_FAMILY,
      goals: { expenseGoals: [{ name: "", type: "other", amount: 0, years: 1 }] },
    });
    expect(intakeSubmitSchema.safeParse(pruned).success).toBe(true);
  });

  it("leaves a payload with no goals key untouched", () => {
    const pruned = pruneIntakeBlankRows({ family: MIN_FAMILY }) as Record<string, unknown>;
    expect(pruned.goals).toBeUndefined();
  });

  it("caps the goal list", () => {
    const tooMany = submitGoals({
      expenseGoals: Array.from({ length: 21 }, () => ({
        name: "x",
        type: "other",
        amount: 1,
      })),
    });
    expect(tooMany.success).toBe(false);
  });
});

describe("intakeSubmitSchemaFor", () => {
  const completeFamily = {
    primary: {
      firstName: "Jane",
      lastName: "Smith",
      dateOfBirth: "1980-04-01",
      maritalStatus: "single" as const,
    },
    children: [],
  };

  it("requires family when the family section is included", () => {
    const schema = intakeSubmitSchemaFor(["family", "documents"]);
    expect(() => schema.parse({})).toThrow();
  });

  it("accepts a payload with no family when the family section is excluded", () => {
    const schema = intakeSubmitSchemaFor(["documents"]);
    const parsed = schema.parse({});
    expect(parsed.family).toBeUndefined();
    expect(parsed.accounts).toEqual([]);
  });

  it("still validates a PRESENT family even when the section is excluded", () => {
    // A half-filled family that somehow rode along is still bad data.
    const schema = intakeSubmitSchemaFor(["documents"]);
    expect(() => schema.parse({ family: { primary: { firstName: "Jane" } } })).toThrow();
  });

  it("parses a complete family when the section is included", () => {
    const schema = intakeSubmitSchemaFor(["family"]);
    const parsed = schema.parse({ family: completeFamily });
    expect(parsed.family?.primary.firstName).toBe("Jane");
  });

  it("intakeSubmitSchema still requires family (default set includes it)", () => {
    expect(() => intakeSubmitSchema.parse({})).toThrow();
  });
});
