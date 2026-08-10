import { describe, expect, it } from "vitest";

import { intakeNoteBody } from "@/lib/intake/note-body";
import type { IntakePayload } from "@/lib/intake/schema";
import { DEFAULT_INTAKE_SECTIONS, type IntakeSectionKey } from "@/lib/intake/sections";

const ALL: IntakeSectionKey[] = [...DEFAULT_INTAKE_SECTIONS, "risk"];

/** A payload with every section populated, so each test can narrow from full. */
function payload(over: Partial<IntakePayload> = {}): IntakePayload {
  return {
    family: {
      primary: {
        firstName: "Jane",
        lastName: "Doe",
        dateOfBirth: "1975-04-02",
        maritalStatus: "married",
      },
      spouse: {
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: "1977-11-30",
      },
      stateOfResidence: "CA",
      children: [
        { firstName: "Aiden", lastName: "Doe", dateOfBirth: "2010-06-01" },
        { firstName: "Mia", lastName: "Doe", dateOfBirth: "2013-02-14" },
      ],
    },
    accounts: [
      {
        name: "401(k)",
        category: "retirement",
        value: 450_000,
        owner: "client",
        custodian: "Fidelity",
      },
    ],
    income: [
      {
        name: "Salary",
        type: "salary",
        annualAmount: 180_000,
        owner: "client",
        endsAtRetirement: true,
      },
    ],
    property: [
      {
        name: "Primary home",
        kind: "real_estate",
        value: 850_000,
        owner: "joint",
        annualPropertyTax: 9_000,
        annualInsurance: 2_100,
        mortgage: {
          balance: 320_000,
          yearsRemaining: 22,
          interestRatePct: 3.1,
          monthlyPayment: 1_850,
        },
      },
    ],
    goals: {
      clientRetirementAge: 65,
      spouseRetirementAge: 63,
      annualRetirementExpenses: 120_000,
      expenseGoals: [
        {
          name: "Lake cabin",
          type: "home",
          amount: 80_000,
          startYear: 2030,
          years: 1,
          forWhom: "client",
        },
        {
          name: "Aiden college",
          type: "education",
          amount: 30_000,
          startYear: 2035,
          years: 4,
          forWhom: "child:0",
        },
      ],
      topics: ["charitable", "care"],
      topicsNote: "We may need to help my mother with care costs.",
    },
    risk: {
      answers: { q1: "a", q2: "c", q3: "b" },
      environmentNote: "Markets make me nervous but I can ride it out.",
      rtqVersion: 1,
    },
    meta: { completedSections: [] },
    ...over,
  } as IntakePayload;
}

describe("intakeNoteBody", () => {
  it("leads with Goals so the notes-list preview shows what the client wants", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    expect(body.startsWith("## Goals")).toBe(true);
    // Goals must precede every other section.
    for (const heading of ["## Family", "## Accounts", "## Income", "## Property"]) {
      expect(body.indexOf("## Goals")).toBeLessThan(body.indexOf(heading));
    }
  });

  it("renders retirement ages, target spending, funded goals and radar topics", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    expect(body).toContain("Client retires at 65");
    expect(body).toContain("Spouse retires at 63");
    expect(body).toContain("$120,000");
    // Funded goal: label, amount, span, and who it's for.
    expect(body).toContain("Lake cabin");
    expect(body).toContain("Home purchase");
    expect(body).toContain("$80,000");
    expect(body).toContain("2030");
    // Multi-year education goal spans 2035–2038 and names the child.
    expect(body).toContain("2035–2038");
    expect(body).toContain("Aiden");
    // Radar topics use their client-facing wording, not the slug.
    expect(body).toContain("Charitable giving");
    expect(body).toContain("Long-term care, for us or a parent");
    expect(body).not.toContain("family_support");
    // The free-text note survives verbatim.
    expect(body).toContain("We may need to help my mother with care costs.");
  });

  it("renders family, accounts, income and property detail", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    expect(body).toContain("Jane Doe");
    expect(body).toContain("John Doe");
    expect(body).toContain("Aiden Doe");
    expect(body).toContain("Mia Doe");
    expect(body).toContain("CA");
    expect(body).toContain("401(k)");
    expect(body).toContain("$450,000");
    expect(body).toContain("Fidelity");
    expect(body).toContain("Salary");
    expect(body).toContain("$180,000");
    expect(body).toContain("Primary home");
    expect(body).toContain("$850,000");
    expect(body).toContain("$320,000");
    expect(body).toContain("3.1%");
  });

  // Both caught by rendering a sample and reading it, not by the substring
  // assertions above — which passed happily while the output read
  // "Jane Doeb. Apr 2, 1975" and "Salary — Salary · $180,000/yr".
  it("separates every detail it appends to a name", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    expect(body).toContain("- Jane Doe · b. Apr 2, 1975 · Married");
    expect(body).toContain("- Spouse: John Doe · b. Nov 30, 1977");
    expect(body).toContain("- Child: Aiden Doe · b. Jun 1, 2010");
  });

  it("drops a name with no details rather than leaving a dangling separator", () => {
    const body = intakeNoteBody(
      payload({
        family: {
          primary: { firstName: "Jane", lastName: "Doe" },
          children: [],
        } as unknown as IntakePayload["family"],
      }),
      ["family"],
      { currentYear: 2026 },
    )!;
    expect(body).toContain("- Jane Doe");
    expect(body).not.toContain("Jane Doe ·");
  });

  it("does not echo a type label that just repeats the row's own name", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    // The wizard pre-fills an income row's name from its type.
    expect(body).not.toContain("Salary — Salary");
    expect(body).toContain("- Salary — $180,000/yr");
    // A name that differs still gets its label.
    expect(body).toContain("401(k) — Retirement");
  });

  it("summarises risk without dumping raw questionnaire option ids", () => {
    const body = intakeNoteBody(payload(), ALL, { currentYear: 2026 })!;
    expect(body).toContain("Markets make me nervous but I can ride it out.");
    // The scored profile lives on the client record; raw q/a pairs are noise.
    expect(body).not.toContain("q1");
  });

  // The trap this guards: a PREFILLED form seeds `goals` from the client
  // snapshot whatever the advisor chose to collect, so gating on payload
  // content alone would put goals the client never saw into their timeline.
  it("omits a section the form did not collect even when the payload carries it", () => {
    const body = intakeNoteBody(payload(), ["family"], { currentYear: 2026 })!;
    expect(body).toContain("## Family");
    expect(body).not.toContain("## Goals");
    expect(body).not.toContain("Lake cabin");
    expect(body).not.toContain("Charitable giving");
    expect(body).not.toContain("## Accounts");
    expect(body).not.toContain("401(k)");
  });

  it("omits a collected section that the client left empty", () => {
    const body = intakeNoteBody(
      payload({ accounts: [], income: [], property: [] }),
      ALL,
      { currentYear: 2026 },
    )!;
    expect(body).not.toContain("## Accounts");
    expect(body).not.toContain("## Income");
    expect(body).not.toContain("## Property");
    expect(body).toContain("## Goals");
  });

  it("returns null when the form carries nothing worth filing", () => {
    const empty = {
      accounts: [],
      income: [],
      property: [],
      goals: { expenseGoals: [], topics: [] },
      meta: { completedSections: [] },
    } as unknown as IntakePayload;
    expect(intakeNoteBody(empty, ALL, { currentYear: 2026 })).toBeNull();
  });

  it("still files the radar answers when Goals is the only thing collected", () => {
    const body = intakeNoteBody(
      payload({
        goals: {
          expenseGoals: [],
          topics: ["debt"],
          topicsNote: undefined,
        } as unknown as IntakePayload["goals"],
      }),
      ["goals"],
      { currentYear: 2026 },
    )!;
    expect(body).toContain("Paying off debt");
    expect(body).not.toContain("## Family");
  });

  it("is pure — the same input renders the same output", () => {
    const p = payload();
    expect(intakeNoteBody(p, ALL, { currentYear: 2026 })).toBe(
      intakeNoteBody(p, ALL, { currentYear: 2026 }),
    );
  });
});
