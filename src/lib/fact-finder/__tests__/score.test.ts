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

describe("applyLinkScores — a contradiction never links on its own", () => {
  it("an account whose last 4 and custodian both differ is offered, but needs a click", () => {
    const r = records();
    r.candidates.accounts = [
      { id: "a-fid", name: "Roth IRA", category: "retirement", accountNumberLast4: "1234", custodian: "Fidelity", value: 100000, ownerIds: ["fm-c"] },
    ];
    const s = applyLinkScores(
      stateWith({ retirement: [row("r", { accountName: "Roth IRA", custodian: "Charles Schwab", last4: "9999", owner: "Client", currentValue: 80000 })] }),
      r,
    );
    const link = linkOf(s, "retirement");
    expect(link).toMatchObject({ kind: "existing", recordId: "a-fid", confirmed: false });
    expect(link?.kind === "existing" && link.score).toBeLessThan(0.9);
    expect(s.sections.retirement[0].linkCandidates?.map((c) => c.recordId)).toEqual(["a-fid"]);
  });

  it("an account with the same last 4 at another custodian needs a click", () => {
    const r = records();
    r.candidates.accounts = [
      { id: "a-fid", name: "Roth IRA", category: "retirement", accountNumberLast4: "1234", custodian: "Fidelity", value: 100000, ownerIds: ["fm-c"] },
    ];
    const s = applyLinkScores(
      stateWith({ retirement: [row("r", { accountName: "Roth IRA", custodian: "Vanguard", last4: "1234", owner: "Client", currentValue: 100000 })] }),
      r,
    );
    expect(linkOf(s, "retirement")).toMatchObject({ recordId: "a-fid", confirmed: false });
  });

  it("a life policy from another carrier with another policy number needs a click", () => {
    const r = records();
    r.candidates.lifePolicies = [
      { id: "p-banner", carrier: "Banner Life", policyNumberLast4: "1111", insuredPerson: "client", policyType: "term", faceValue: 1000000 },
    ];
    const s = applyLinkScores(
      stateWith({ life: [row("l", { carrier: "Prudential", policyNumber: "5678", policyType: "Term", insured: "Client", deathBenefit: 1000000 })] }),
      r,
    );
    const link = linkOf(s, "life");
    expect(link).toMatchObject({ kind: "existing", recordId: "p-banner", confirmed: false });
    expect(link?.kind === "existing" && link.score).toBeLessThan(0.9);
  });

  it("a family member with the same name but another date of birth needs a click", () => {
    const s = applyLinkScores(
      stateWith({ family: [row("e", { firstName: "Emma", lastName: "Hendricks", dateOfBirth: "2006-01-02" })] }),
      records(),
    );
    const link = linkOf(s, "family");
    expect(link).toMatchObject({ kind: "existing", recordId: "fm-e", confirmed: false });
    expect(link?.kind === "existing" && link.score).toBeLessThan(0.9);
  });

  it("still links when nothing contradicts: one side has no last 4, and the custodians agree", () => {
    const r = records();
    r.candidates.accounts = [
      { id: "a-sch", name: "Roth IRA", category: "retirement", accountNumberLast4: null, custodian: "Schwab", value: 100000, ownerIds: ["fm-c"] },
    ];
    const s = applyLinkScores(
      stateWith({ retirement: [row("r", { accountName: "Roth IRA", custodian: "Charles Schwab", last4: "9999", owner: "Client", currentValue: 100000 })] }),
      r,
    );
    expect(linkOf(s, "retirement")).toMatchObject({ recordId: "a-sch", confirmed: true });
  });
});

describe("applyLinkScores — a tie at the top never links on its own", () => {
  it("two debts with the row's name: the row needs a click", () => {
    const r = records();
    r.candidates.liabilities = [
      { id: "l-c", name: "Student Loan", balance: 20000 },
      { id: "l-s", name: "Student Loan", balance: 35000 },
    ];
    const s = applyLinkScores(stateWith({ liab: [row("l", { loanName: "Student Loan", balance: 30000 })] }), r);
    expect(linkOf(s, "liab")).toMatchObject({ kind: "existing", confirmed: false });
  });

  it("two same-year, same-amount gifts: the recipient tells them apart", () => {
    const r = records();
    r.gifts = [
      { id: "g-emma", year: 2023, grantor: "client", amount: 18000, recipient: { name: "Emma Hendricks", firstName: "Emma" } },
      { id: "g-lucas", year: 2023, grantor: "client", amount: 18000, recipient: { name: "Lucas Hendricks", firstName: "Lucas" } },
    ];
    const s = applyLinkScores(stateWith({ gifts: [row("g", { year: 2023, from: "Client", recipient: "Lucas", amount: 18000 })] }), r);
    expect(linkOf(s, "gifts")).toMatchObject({ kind: "existing", recordId: "g-lucas", confirmed: true });
    expect(s.sections.gifts[0].linkCandidates?.map((c) => c.label)).toEqual([
      "2023 gift of $18,000 to Lucas Hendricks",
      "2023 gift of $18,000 to Emma Hendricks",
    ]);
  });

  it("two same-year, same-amount gifts and a row naming no recipient: the row needs a click", () => {
    const r = records();
    r.gifts = [
      { id: "g-emma", year: 2023, grantor: "client", amount: 18000, recipient: { name: "Emma Hendricks", firstName: "Emma" } },
      { id: "g-lucas", year: 2023, grantor: "client", amount: 18000, recipient: { name: "Lucas Hendricks", firstName: "Lucas" } },
    ];
    const s = applyLinkScores(stateWith({ gifts: [row("g", { year: 2023, from: "Client", amount: 18000 })] }), r);
    expect(linkOf(s, "gifts")).toMatchObject({ kind: "existing", confirmed: false });
  });

  it("an unnamed disability row that two policies fit needs a click", () => {
    const r = records();
    r.disabilityPolicies = [
      { id: "d-ltd", name: "Acme LTD", insured: "client", carrier: "Unum" },
      { id: "d-std", name: "Acme STD", insured: "client", carrier: "Unum" },
    ];
    const s = applyLinkScores(stateWith({ disability: [row("d", { whoIsCovered: "Client", carrier: "Unum" })] }), r);
    expect(linkOf(s, "disability")).toMatchObject({ kind: "existing", confirmed: false });
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

  it("links family on first name and date of birth, whatever the last names say", () => {
    const s = applyLinkScores(
      stateWith({
        family: [
          row("no-last", { firstName: "Emma", dateOfBirth: "2004-05-21" }),
          row("married", { firstName: "Emma", lastName: "Carter", dateOfBirth: "2004-05-21" }),
        ],
      }),
      records(),
    );
    // One record, two rows: the first confirms it, the second is offered it.
    expect(linkOf(s, "family", 0)).toMatchObject({ recordId: "fm-e", confirmed: true });
    expect(s.sections.family[1].linkCandidates?.map((c) => c.recordId)).toEqual(["fm-e"]);
    const married = applyLinkScores(stateWith({ family: [row("married", { firstName: "Emma", lastName: "Carter", dateOfBirth: "2004-05-21" })] }), records());
    expect(linkOf(married, "family")).toMatchObject({ recordId: "fm-e", confirmed: true });
  });

  it("without a date of birth, family links only on first and last name", () => {
    const s = applyLinkScores(
      stateWith({ family: [row("same", { firstName: "Emma", lastName: "Hendricks" }), row("other", { firstName: "Emma", lastName: "Carter" })] }),
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

  it("links a Trusts row to a trust only — never to an LLC with the same name", () => {
    const r = records();
    r.candidates.entities = [
      { id: "ent-llc", name: "Hendricks Holdings", entityType: "llc" },
      { id: "ent-trust", name: "Hendricks Holdings", entityType: "trust" },
      { id: "ent-acme", name: "Acme Ventures", entityType: "llc" },
    ];
    const s = applyLinkScores(
      stateWith({ trusts: [row("t1", { trustName: "Hendricks Holdings" }), row("t2", { trustName: "Acme Ventures" })] }),
      r,
    );
    expect(linkOf(s, "trusts", 0)).toMatchObject({ recordId: "ent-trust", confirmed: true });
    expect(s.sections.trusts[0].linkCandidates).toEqual([{ recordId: "ent-trust", label: "Hendricks Holdings", score: 1 }]);
    expect(linkOf(s, "trusts", 1)).toEqual({ kind: "new", by: "auto" });
    expect(s.sections.trusts[1].linkCandidates).toEqual([]);
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
