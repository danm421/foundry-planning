// src/lib/fact-finder/__tests__/score.test.ts
import { describe, expect, it } from "vitest";
import { applyLinkScores, scoreCandidates } from "../matching/score";
import { emptyExistingRecords, type ExistingRecords } from "../records/types";
import { findSection } from "../schema";
import { emptyFactFinderState } from "../state";
import type { FactFinderState, FFCellValue, FFRow } from "../types";

function records(): ExistingRecords {
  const r = emptyExistingRecords();
  r.candidates.family = [
    { id: "fm-c", role: "client", firstName: "Mark", lastName: "Hendricks" },
    { id: "fm-s", role: "spouse", firstName: "Laura", lastName: "Hendricks" },
  ];
  r.candidates.accounts = [
    { id: "a-ira", name: "Fidelity IRA", category: "retirement", accountNumberLast4: "2201", custodian: "Fidelity", value: 640000, ownerIds: ["fm-c"] },
    { id: "a-brk", name: "Joint Brokerage", category: "taxable", accountNumberLast4: null, custodian: "Charles Schwab", value: 300000, ownerIds: ["fm-c", "fm-s"] },
    { id: "a-life", name: "NWM Term", category: "life_insurance", accountNumberLast4: null, custodian: null, value: 0 },
  ];
  r.candidates.familyMembers = [
    { id: "fm-c", firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12" },
    { id: "fm-e", firstName: "Emma", lastName: "Hendricks", dateOfBirth: "2004-05-21" },
  ];
  r.candidates.incomes = [
    { id: "i-sal", type: "salary", name: "Mark salary", owner: "client" },
    { id: "i-ss", type: "social_security", name: "Mark Social Security", owner: "client" },
  ];
  r.candidates.livingSlots = [{ id: "e-cur", name: "Current living expenses", role: "current" }];
  r.externalBeneficiaries = [{ id: "x-1", name: "Denver Rescue Mission" }];
  r.disabilityPolicies = [{ id: "d-1", name: "Acme LTD", insured: "client", carrier: "Unum" }];
  return r;
}

const row = (id: string, values: Record<string, FFCellValue>, extra: Partial<FFRow> = {}): FFRow => ({
  id,
  cells: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, by: "document" as const, confidence: 0.9 }])),
  sourceFileIds: ["f1"],
  ...extra,
});
function stateWith(rows: Record<string, FFRow[]>): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, sections: { ...s.sections, ...rows } };
}
const linkOf = (s: FactFinderState, sectionId: string, index = 0) => s.sections[sectionId][index].link;

describe("applyLinkScores — accounts", () => {
  it("auto-links an account-number match as confirmed", () => {
    const s = applyLinkScores(stateWith({ retirement: [row("r1", { accountName: "Mark IRA", last4: "2201", custodian: "Fidelity" })] }), records());
    expect(linkOf(s, "retirement")).toEqual({ kind: "existing", recordId: "a-ira", score: 1, confirmed: true, by: "auto" });
    expect(s.sections.retirement[0].linkCandidates?.[0]).toEqual({ recordId: "a-ira", label: "Fidelity IRA ··2201", score: 1 });
  });

  it("auto-links a strong match, asks for a click on a middling one, and makes a weak one New", () => {
    const s = applyLinkScores(
      stateWith({
        taxable: [
          row("strong", { accountName: "Joint Brokerage", owner: "Joint", currentValue: 300000 }),
          row("middling", { accountName: "Brokerage", owner: "Client", currentValue: 150000 }),
        ],
        cash: [row("weak", { accountName: "Emergency fund", owner: "Client", currentValue: 5000 })],
      }),
      records(),
    );
    expect(linkOf(s, "taxable", 0)).toMatchObject({ kind: "existing", recordId: "a-brk", confirmed: true });
    const middling = linkOf(s, "taxable", 1);
    expect(middling).toMatchObject({ kind: "existing", recordId: "a-brk", confirmed: false });
    expect(middling?.kind === "existing" && middling.score).toBeGreaterThanOrEqual(0.45);
    expect(middling?.kind === "existing" && middling.score).toBeLessThan(0.9);
    expect(linkOf(s, "cash")).toEqual({ kind: "new", by: "auto" });
  });

  it("gives one record to one row: a second claimant needs a click", () => {
    const s = applyLinkScores(
      stateWith({
        retirement: [
          row("first", { accountName: "IRA", last4: "2201", custodian: "Fidelity" }),
          row("second", { accountName: "IRA again", last4: "2201", custodian: "Fidelity" }),
        ],
      }),
      records(),
    );
    expect(linkOf(s, "retirement", 0)).toMatchObject({ recordId: "a-ira", confirmed: true });
    expect(linkOf(s, "retirement", 1)).toMatchObject({ recordId: "a-ira", confirmed: false });
  });

  it("never matches an account section to a life insurance account", () => {
    expect(scoreCandidates(findSection("cash")!, row("c", { accountName: "NWM Term" }), records())).toEqual([]);
  });
});

describe("applyLinkScores — what it leaves alone", () => {
  it("keeps advisor decisions and rows with no values, and rescores automatic New", () => {
    const start = stateWith({
      retirement: [
        row("picked", { accountName: "Something", last4: "2201", custodian: "Fidelity" }, { link: { kind: "new", by: "advisor" } }),
        row("empty", {}),
      ],
      taxable: [row("auto-new", { accountName: "Joint Brokerage", owner: "Joint", currentValue: 300000 }, { link: { kind: "new", by: "auto" } })],
    });
    const s = applyLinkScores(start, records());
    expect(s.sections.retirement[0]).toBe(start.sections.retirement[0]);
    expect(s.sections.retirement[1]).toBe(start.sections.retirement[1]);
    expect(linkOf(s, "taxable")).toMatchObject({ kind: "existing", recordId: "a-brk", confirmed: true });
  });

  it("returns the same state when nothing changes", () => {
    const once = applyLinkScores(stateWith({ retirement: [row("r1", { accountName: "IRA", last4: "2201", custodian: "Fidelity" })] }), records());
    expect(applyLinkScores(once, records())).toBe(once);
  });
});

describe("applyLinkScores — one record, one live row", () => {
  it("a Removed-tray row holds no claim: a live row still auto-links, and the tray keeps its link", () => {
    const trayRow = row("gone", { accountName: "Old IRA", last4: "2201" }, { link: { kind: "existing", recordId: "a-ira", score: 1, confirmed: true, by: "auto" } });
    const start: FactFinderState = {
      ...stateWith({ retirement: [row("live", { accountName: "IRA", last4: "2201", custodian: "Fidelity" })] }),
      removed: [{ sectionId: "retirement", row: trayRow, reason: "Duplicate", by: "advisor", at: "2026-10-12T00:00:00.000Z" }],
    };
    const s = applyLinkScores(start, records());
    expect(linkOf(s, "retirement")).toMatchObject({ recordId: "a-ira", confirmed: true });
    expect(s.removed).toBe(start.removed);
  });

  it("settles automatic links first, so an earlier row never suggests a record a later row confirms", () => {
    const r = records();
    r.disabilityPolicies = [
      { id: "d-x", name: "Acme LTD", insured: "client", carrier: "Unum" },
      { id: "d-y", name: "Acme STD", insured: "client", carrier: null },
    ];
    const once = applyLinkScores(
      stateWith({
        disability: [
          row("a", { policyName: "Acme Group", whoIsCovered: "Client", carrier: "Unum" }),
          row("b", { policyName: "Acme LTD", whoIsCovered: "Client", carrier: "Unum" }),
        ],
      }),
      r,
    );
    expect(linkOf(once, "disability", 0)).toMatchObject({ recordId: "d-y", confirmed: false });
    expect(linkOf(once, "disability", 1)).toMatchObject({ recordId: "d-x", confirmed: true });
    expect(applyLinkScores(once, r)).toBe(once);
  });

  it("an exact account-number match wins the record over an earlier row's strong name match", () => {
    const r = records();
    r.candidates.accounts = r.candidates.accounts.map((a) => (a.id === "a-brk" ? { ...a, accountNumberLast4: "7788" } : a));
    const s = applyLinkScores(
      stateWith({
        taxable: [
          row("by-name", { accountName: "Joint Brokerage", owner: "Joint", currentValue: 300000 }),
          row("by-number", { accountName: "Schwab", last4: "7788", custodian: "Charles Schwab" }),
        ],
      }),
      r,
    );
    expect(linkOf(s, "taxable", 0)).toMatchObject({ confirmed: false });
    expect(linkOf(s, "taxable", 1)).toMatchObject({ recordId: "a-brk", confirmed: true });
  });

  it("a row whose best record another row confirms needs a click, never auto-confirms its runner-up", () => {
    const r = records();
    r.candidates.accounts = [
      ...r.candidates.accounts.map((a) => (a.id === "a-brk" ? { ...a, accountNumberLast4: "7788" } : a)),
      { id: "a-brk2", name: "Joint Brokerage", category: "taxable", accountNumberLast4: null, custodian: null, value: 270000, ownerIds: ["fm-c", "fm-s"] },
    ];
    const once = applyLinkScores(
      stateWith({
        taxable: [
          row("by-name", { accountName: "Joint Brokerage", owner: "Joint", currentValue: 300000 }),
          row("by-number", { accountName: "Schwab", last4: "7788", custodian: "Charles Schwab" }),
        ],
      }),
      r,
    );
    const scored = once.sections.taxable[0].linkCandidates!;
    expect(scored.map((c) => c.recordId)).toEqual(["a-brk", "a-brk2"]);
    expect(scored[1].score).toBeGreaterThanOrEqual(0.9);
    expect(linkOf(once, "taxable", 1)).toMatchObject({ recordId: "a-brk", confirmed: true });
    expect(linkOf(once, "taxable", 0)).toMatchObject({ recordId: "a-brk2", confirmed: false });
    expect(applyLinkScores(once, r)).toBe(once);
  });

  it("a fixed row whose record another live row already confirms needs a click", () => {
    const start = emptyFactFinderState();
    start.sections.salary[0] = row(start.sections.salary[0].id, { annualSalary: 165000 });
    start.sections.income = [
      row("picked", { incomeName: "Mark pay" }, { link: { kind: "existing", recordId: "i-sal", score: null, confirmed: true, by: "advisor" } }),
    ];
    const s = applyLinkScores(start, records());
    expect(linkOf(s, "salary", 0)).toMatchObject({ recordId: "i-sal", confirmed: false });
    expect(linkOf(s, "income")).toMatchObject({ recordId: "i-sal", confirmed: true });
  });
});

describe("applyLinkScores — other record kinds", () => {
  it("links family on name and date of birth, never to the client or co-client", () => {
    const s = applyLinkScores(
      stateWith({
        family: [
          row("emma", { firstName: "Emma", lastName: "Hendricks", dateOfBirth: "2004-05-21" }),
          row("mark", { firstName: "Mark", lastName: "Hendricks", dateOfBirth: "1968-04-12" }),
        ],
      }),
      records(),
    );
    expect(linkOf(s, "family", 0)).toMatchObject({ recordId: "fm-e", confirmed: true });
    expect(linkOf(s, "family", 1)).toEqual({ kind: "new", by: "auto" });
  });

  it("links charities by name and insurance policies by name, insured and carrier", () => {
    const s = applyLinkScores(
      stateWith({
        external: [row("x", { name: "Denver Rescue Mission", kind: "Charity" })],
        disability: [row("d", { policyName: "Acme LTD", whoIsCovered: "Client", carrier: "Unum" })],
      }),
      records(),
    );
    expect(linkOf(s, "external")).toMatchObject({ recordId: "x-1", confirmed: true });
    expect(linkOf(s, "disability")).toMatchObject({ recordId: "d-1", confirmed: true });
  });

  it("links same-day equity grants of different types to their own records", () => {
    const r = records();
    r.stockOptionGrants = [
      { id: "g-rsu", accountName: "Acme Corp", grantNumber: null, grantDate: "2024-03-01", grantType: "rsu" },
      { id: "g-nqso", accountName: "Acme Corp", grantNumber: null, grantDate: "2024-03-01", grantType: "nqso" },
    ];
    const s = applyLinkScores(
      stateWith({
        equity: [
          row("nqso", { company: "Acme Corp", grantType: "NQSO", grantDate: "2024-03-01" }),
          row("rsu", { company: "Acme Corp", grantType: "RSU", grantDate: "2024-03-01" }),
        ],
      }),
      r,
    );
    expect(linkOf(s, "equity", 0)).toMatchObject({ recordId: "g-nqso", confirmed: true });
    expect(linkOf(s, "equity", 1)).toMatchObject({ recordId: "g-rsu", confirmed: true });
    expect(s.sections.equity[0].linkCandidates?.map((c) => c.recordId)).toEqual(["g-nqso"]);
  });

  it("still suggests a grant whose type the document named in a way that isn't an option", () => {
    const r = records();
    r.stockOptionGrants = [{ id: "g-rsu", accountName: "Acme Corp", grantNumber: null, grantDate: "2024-03-01", grantType: "rsu" }];
    const scored = scoreCandidates(
      findSection("equity")!,
      row("e", { company: "Acme Corp", grantType: "Performance shares", grantDate: "2024-03-01" }),
      r,
    );
    expect(scored.map((c) => c.recordId)).toEqual(["g-rsu"]);
  });

  it("links fixed rows implicitly to that person's income or the living-expense slot", () => {
    const start = emptyFactFinderState();
    const fill = (sectionId: string, index: number, values: Record<string, FFCellValue>) => {
      const fixed = start.sections[sectionId][index];
      start.sections[sectionId][index] = row(fixed.id, values);
    };
    fill("salary", 0, { employer: "Acme", annualSalary: 165000 });
    fill("ss", 1, { monthlyBenefit: 1800 });
    fill("living", 0, { annualAmount: 96000 });
    const s = applyLinkScores(start, records());
    expect(linkOf(s, "salary", 0)).toMatchObject({ recordId: "i-sal", confirmed: true });
    expect(linkOf(s, "salary", 1)).toBeUndefined();
    expect(linkOf(s, "ss", 1)).toEqual({ kind: "new", by: "auto" });
    expect(linkOf(s, "living", 0)).toMatchObject({ recordId: "e-cur", confirmed: true });
  });
});
