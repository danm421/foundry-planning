import { describe, expect, it } from "vitest";

import {
  buildIntakeAnswersDocument,
  type AnswerBlock,
  type IntakeAnswersInput,
} from "@/lib/intake/answers-document";
import type { IntakePayload } from "@/lib/intake/schema";
import { INTAKE_SECTIONS, type IntakeSectionKey } from "@/lib/intake/sections";
import { RTQ_V1 } from "@/lib/risk/rtq";

function payload(over: Partial<IntakePayload> = {}): IntakePayload {
  return {
    family: {
      primary: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1975-04-02", maritalStatus: "married" },
      spouse: { firstName: "John", lastName: "Doe", dateOfBirth: "1977-11-30" },
      stateOfResidence: "CA",
      children: [{ firstName: "Aiden", lastName: "Doe", dateOfBirth: "2010-06-01" }],
    },
    accounts: [
      { name: "401(k)", category: "retirement", value: 450_000, owner: "client", custodian: "Fidelity" },
      { name: "Joint brokerage", category: "taxable", value: 120_000, owner: "joint" },
    ],
    income: [
      { name: "Salary", type: "salary", annualAmount: 180_000, owner: "client", endsAtRetirement: true },
    ],
    property: [
      {
        name: "Primary home",
        kind: "real_estate",
        value: 850_000,
        owner: "joint",
        annualPropertyTax: 9_000,
        mortgage: { balance: 320_000, interestRatePct: 3.1 },
      },
    ],
    goals: {
      clientRetirementAge: 65,
      annualRetirementExpenses: 120_000,
      expenseGoals: [
        { name: "Aiden college", type: "education", amount: 30_000, startYear: 2035, years: 4, forWhom: "child:0" },
      ],
      topics: ["charitable"],
      topicsNote: "We may need to help my mother.",
    },
    meta: { completedSections: [] },
    ...over,
  } as IntakePayload;
}

function input(over: Partial<IntakeAnswersInput> = {}): IntakeAnswersInput {
  return {
    payload: payload(),
    sections: ["family", "accounts", "income", "property", "goals", "documents"],
    documents: [],
    recipientName: "Jane Doe",
    recipientEmail: "jane@example.com",
    sentAt: new Date("2026-09-28T15:00:00Z"),
    submittedAt: new Date("2026-10-03T15:00:00Z"),
    currentYear: 2026,
    ...over,
  };
}

const section = (sections: IntakeSectionKey[], key: IntakeSectionKey, over: Partial<IntakeAnswersInput> = {}) =>
  buildIntakeAnswersDocument(input({ sections, ...over })).sections.find((s) => s.key === key)!;

const table = (blocks: AnswerBlock[]) =>
  blocks.find((b): b is Extract<AnswerBlock, { kind: "table" }> => b.kind === "table")!;

describe("buildIntakeAnswersDocument", () => {
  it("prints only the sections the form collected, in the order the client filled them in", () => {
    // Stored order is deliberately scrambled; output follows INTAKE_SECTIONS.
    const doc = buildIntakeAnswersDocument(input({ sections: ["goals", "family", "accounts"] }));
    expect(doc.sections.map((s) => s.key)).toEqual(["family", "accounts", "goals"]);
    // The payload holds income and property too — a prefilled form seeds them —
    // but the client was never asked, so they are not printed.
    expect(doc.sections.map((s) => s.title)).not.toContain("Income");
  });

  it("names the household from the family answers and stamps the dates", () => {
    const doc = buildIntakeAnswersDocument(input());
    expect(doc.householdName).toBe("Jane & John Doe");
    expect(doc.completedBy).toBe("Jane Doe · jane@example.com");
    expect(doc.sentOn).toBe("September 28, 2026");
    expect(doc.submittedOn).toBe("October 3, 2026");
  });

  it("falls back to the recipient when the form never asked for family", () => {
    const doc = buildIntakeAnswersDocument(
      input({ payload: payload({ family: undefined }), sections: ["accounts"], recipientName: null }),
    );
    expect(doc.householdName).toBe("jane@example.com");
    expect(doc.completedBy).toBe("jane@example.com");
  });

  it("lays family out as person cards, a children table and the state", () => {
    const { blocks } = section([...INTAKE_SECTIONS], "family");
    const people = blocks.find((b) => b.kind === "people");
    expect(people).toEqual({
      kind: "people",
      people: [
        {
          role: "Client",
          name: "Jane Doe",
          fields: [
            { label: "Date of birth", value: "Apr 2, 1975" },
            { label: "Marital status", value: "Married" },
          ],
        },
        { role: "Co-client", name: "John Doe", fields: [{ label: "Date of birth", value: "Nov 30, 1977" }] },
      ],
    });
    expect(table(blocks).rows).toEqual([{ cells: ["Aiden Doe", "Jun 1, 2010"] }]);
    expect(blocks).toContainEqual({ kind: "fields", fields: [{ label: "State of residence", value: "CA" }] });
  });

  it("totals the accounts and keeps a column only when some row filled it in", () => {
    const t = table(section(["accounts"], "accounts").blocks);
    // Custodian kept (one row has it); cost basis dropped (no row does).
    expect(t.columns.map((c) => c.label)).toEqual(["Account", "Type", "Owner", "Custodian", "Value"]);
    expect(t.rows[0].cells).toEqual(["401(k)", "Retirement", "Jane", "Fidelity", "$450,000"]);
    expect(t.rows[1].cells).toEqual(["Joint brokerage", "Taxable investments", "Joint", "—", "$120,000"]);
    expect(t.total).toEqual(["Total", "", "", "", "$570,000"]);
  });

  it("prints no total under a single row", () => {
    const t = table(section(["income"], "income").blocks);
    expect(t.rows[0].cells).toEqual(["Salary", "Salary", "Jane", "2026 – retirement", "$180,000"]);
    expect(t.total).toBeUndefined();
  });

  it("prints each person's Social Security answer under income", () => {
    const { blocks } = section(["income"], "income", {
      payload: payload({
        socialSecurity: { client: { piaMonthly: 2_800, claimingAge: 67 }, spouse: { claimingAge: 65 } },
      }),
    });
    expect(blocks[1]).toEqual({
      kind: "fields",
      heading: "Social Security",
      fields: [
        { label: "Jane", value: "$2,800/mo at FRA · start at 67" },
        { label: "John", value: "Start at 65" },
      ],
    });
  });

  it("counts a Social Security answer alone as income answered", () => {
    const { blocks } = section(["income"], "income", {
      payload: payload({ income: [], socialSecurity: { client: { claimingAge: 70 } } }),
    });
    expect(blocks).toEqual([
      { kind: "fields", heading: "Social Security", fields: [{ label: "Jane", value: "Start at 70" }] },
    ]);
  });

  it("puts a property's carrying costs and mortgage on the row's second line", () => {
    const t = table(section(["property"], "property").blocks);
    expect(t.rows[0].note).toBe("Property tax $9,000/yr · Mortgage: $320,000 balance · 3.1%");
  });

  it("still flags a mortgage the client ticked but left blank", () => {
    const t = table(
      section(["property"], "property", {
        payload: payload({
          property: [{ name: "Cabin", kind: "real_estate", value: 200_000, owner: "client", mortgage: {} }],
        }),
      }).blocks,
    );
    expect(t.rows[0].note).toBe("Mortgage");
  });

  it("prints retirement, funded goals, radar topics and the client's own words", () => {
    const { blocks } = section(["goals"], "goals");
    expect(blocks[0]).toEqual({
      kind: "fields",
      heading: "Retirement",
      fields: [
        { label: "Jane's retirement age", value: "65" },
        { label: "Spending in retirement", value: "$120,000/yr" },
      ],
    });
    expect(table(blocks).rows[0].cells).toEqual(["Aiden college", "Education", "Aiden", "2035–2038", "$30,000/yr"]);
    expect(blocks).toContainEqual({ kind: "list", heading: "On their radar", items: ["Charitable giving"] });
    expect(blocks).toContainEqual({ kind: "quote", heading: "In their words", text: "We may need to help my mother." });
  });

  it("says plainly when a collected section came back blank", () => {
    const doc = buildIntakeAnswersDocument(
      input({ payload: payload({ accounts: [], income: [] }), sections: ["accounts", "income", "documents"] }),
    );
    expect(doc.sections.map((s) => s.blocks)).toEqual([
      [{ kind: "empty", text: "No accounts added." }],
      [{ kind: "empty", text: "No income sources added." }],
      [{ kind: "empty", text: "No documents uploaded." }],
    ]);
  });

  it("lists uploaded documents with their type", () => {
    const t = table(
      section(["documents"], "documents", {
        documents: [
          { id: "d1", filename: "2025 return.pdf", docType: "tax_return", sizeBytes: 1, uploadedAt: "2026-10-01T12:00:00.000Z" },
        ],
      }).blocks,
    );
    expect(t.rows[0].cells).toEqual(["2025 return.pdf", "Tax return", "Oct 1, 2026"]);
  });

  it("scores the questionnaire only when every question is answered", () => {
    const all = Object.fromEntries(RTQ_V1.map((q) => [q.id, q.options[0].value]));
    const complete = section(["risk"], "risk", {
      payload: payload({ risk: { answers: all, rtqVersion: 1 } }),
    });
    expect(complete.blocks[0]).toEqual({
      kind: "fields",
      fields: [{ label: "Result", value: "0 · Conservative" }],
    });

    const [firstQ] = RTQ_V1;
    const partial = section(["risk"], "risk", {
      payload: payload({ risk: { answers: { [firstQ.id]: firstQ.options[1].value }, rtqVersion: 1 } }),
    });
    expect(partial.blocks[0]).toEqual({
      kind: "fields",
      fields: [{ label: "Result", value: `Partially answered — 1 of ${RTQ_V1.length} questions` }],
    });
    // Every question is listed so the gaps show.
    const t = table(partial.blocks);
    expect(t.rows).toHaveLength(RTQ_V1.length);
    expect(t.rows[0].cells).toEqual([firstQ.prompt, firstQ.options[1].label]);
    expect(t.rows[1].cells[1]).toBe("—");
  });
});
