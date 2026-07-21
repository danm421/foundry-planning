import { describe, it, expect } from "vitest";
import { generateQuestions, MAX_QUESTIONS } from "../questions";
import type { ImportPayload } from "@/lib/imports/types";

const base: ImportPayload = {
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

describe("generateQuestions", () => {
  it("asks for primary DOB for a new prospect when missing", () => {
    const qs = generateQuestions({ payload: base, assumptions: [], mode: "new", primaryDobKnown: false });
    expect(qs.some((q) => q.id === "q:primary_dob")).toBe(true);
    const dobQuestion = qs.find((q) => q.id === "q:primary_dob");
    expect(dobQuestion?.kind).toBe("identity");
    expect(dobQuestion?.field).toBe("client.primaryDob");
  });

  it("does not ask for DOB when it is known", () => {
    const qs = generateQuestions({
      payload: { ...base, primary: { firstName: "J", dateOfBirth: "1970-01-01" } },
      assumptions: [],
      mode: "new",
      primaryDobKnown: true,
    });
    expect(qs.some((q) => q.id === "q:primary_dob")).toBe(false);
  });

  it("does not ask for DOB when the payload already has one, even if primaryDobKnown is false", () => {
    const qs = generateQuestions({
      payload: { ...base, primary: { firstName: "J", dateOfBirth: "1970-01-01" } },
      assumptions: [],
      mode: "new",
      primaryDobKnown: false,
    });
    expect(qs.some((q) => q.id === "q:primary_dob")).toBe(false);
  });

  it("does not ask for DOB when mode is existing, regardless of primaryDobKnown", () => {
    const qs = generateQuestions({ payload: base, assumptions: [], mode: "existing", primaryDobKnown: false });
    expect(qs.some((q) => q.id === "q:primary_dob")).toBe(false);
  });

  it("caps at MAX_QUESTIONS", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ field: `client.x${i}`, value: 1, reason: "r" }));
    const qs = generateQuestions({ payload: base, assumptions: many, mode: "new", primaryDobKnown: true });
    expect(qs.length).toBeLessThanOrEqual(MAX_QUESTIONS);
  });

  it("produces zero questions from assumptions on non-matching fields", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ field: `client.x${i}`, value: 1, reason: "r" }));
    const qs = generateQuestions({ payload: base, assumptions: many, mode: "new", primaryDobKnown: true });
    expect(qs).toHaveLength(0);
  });

  it("asks an assumption question for a retirement-age default, offering the assumed value", () => {
    const qs = generateQuestions({
      payload: base,
      assumptions: [{ field: "client.retirementAge", value: 65, reason: "defaulted" }],
      mode: "new",
      primaryDobKnown: true,
    });
    const q = qs.find((x) => x.id === "q:retirement_age");
    expect(q).toBeDefined();
    expect(q?.kind).toBe("assumption");
    expect(q?.field).toBe("client.retirementAge");
    expect(q?.options).toEqual(["65 (assumed)", "60", "62", "67", "70"]);
  });

  it("asks an assumption question for a filing-status default, offering the assumed value", () => {
    const qs = generateQuestions({
      payload: base,
      assumptions: [{ field: "client.filingStatus", value: "single", reason: "defaulted" }],
      mode: "new",
      primaryDobKnown: true,
    });
    const q = qs.find((x) => x.id === "q:filing_status");
    expect(q).toBeDefined();
    expect(q?.kind).toBe("assumption");
    expect(q?.field).toBe("client.filingStatus");
    expect(q?.options?.[0]).toBe("single (assumed)");
  });

  it("does not ask an assumption question for unrelated fields like lifeExpectancy", () => {
    const qs = generateQuestions({
      payload: base,
      assumptions: [{ field: "client.lifeExpectancy", value: 92, reason: "defaulted" }],
      mode: "new",
      primaryDobKnown: true,
    });
    expect(qs).toHaveLength(0);
  });

  it("asks a conflict question for a merged-duplicate warning", () => {
    const payload: ImportPayload = {
      ...base,
      warnings: ['Merged duplicate account "Schwab Brokerage" seen in 2 documents.'],
    };
    const qs = generateQuestions({ payload, assumptions: [], mode: "new", primaryDobKnown: true });
    expect(qs).toHaveLength(1);
    expect(qs[0].kind).toBe("conflict");
  });

  it("caps conflict questions at 3 even with more merged-duplicate warnings", () => {
    const payload: ImportPayload = {
      ...base,
      warnings: [
        'Merged duplicate account "A" seen in 2 documents.',
        'Merged duplicate account "B" seen in 2 documents.',
        'Merged duplicate income "C" seen in 2 documents.',
        'Merged duplicate expense "D" seen in 2 documents.',
        'Merged duplicate liability "E" seen in 2 documents.',
      ],
    };
    const qs = generateQuestions({ payload, assumptions: [], mode: "new", primaryDobKnown: true });
    expect(qs.filter((q) => q.kind === "conflict")).toHaveLength(3);
  });

  it("ignores non-merge warnings and fuzzy-match noise", () => {
    const payload: ImportPayload = {
      ...base,
      warnings: [
        "Primary client conflict between files: \"Jane Doe\" vs \"Janet Doe\". Keeping the first.",
        "Fuzzy match candidate found for account 123.",
      ],
    };
    const qs = generateQuestions({ payload, assumptions: [], mode: "new", primaryDobKnown: true });
    expect(qs.filter((q) => q.kind === "conflict")).toHaveLength(0);
  });

  it("produces deterministic, stable question ids across repeated calls", () => {
    const payload: ImportPayload = {
      ...base,
      warnings: ['Merged duplicate account "Schwab Brokerage" seen in 2 documents.'],
    };
    const assumptions = [
      { field: "client.retirementAge", value: 65, reason: "defaulted" },
      { field: "client.filingStatus", value: "single", reason: "defaulted" },
    ];
    const input = { payload, assumptions, mode: "new" as const, primaryDobKnown: false };
    const first = generateQuestions(input);
    const second = generateQuestions(input);
    expect(first.map((q) => q.id)).toEqual(second.map((q) => q.id));
  });

  it("sorts identity before conflict before assumption, surviving an 8-cap truncation", () => {
    const assumptions = [
      { field: "client.retirementAge", value: 65, reason: "defaulted" },
      { field: "client.filingStatus", value: "single", reason: "defaulted" },
    ];
    const payload: ImportPayload = {
      ...base,
      warnings: [
        'Merged duplicate account "A" seen in 2 documents.',
        'Merged duplicate income "B" seen in 2 documents.',
        'Merged duplicate expense "C" seen in 2 documents.',
      ],
    };
    const qs = generateQuestions({ payload, assumptions, mode: "new", primaryDobKnown: false });
    // identity(1) + conflict(3) + assumption(2) = 6 total, under the cap, but
    // still must come back in priority order.
    const kinds = qs.map((q) => q.kind);
    expect(kinds).toEqual(["identity", "conflict", "conflict", "conflict", "assumption", "assumption"]);
  });

  it("returns an empty array when there is nothing to ask", () => {
    const qs = generateQuestions({ payload: base, assumptions: [], mode: "existing", primaryDobKnown: true });
    expect(qs).toEqual([]);
  });
});
