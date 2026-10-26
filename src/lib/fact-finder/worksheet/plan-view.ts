// src/lib/fact-finder/worksheet/plan-view.ts
import type { ExistingRecords } from "../records/types";

const money = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const bits = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(", ");

function section<T>(title: string, items: readonly T[], line: (item: T) => string): string {
  return [`## ${title}`, ...(items.length ? items.map((i) => `- ${line(i)}`) : ["(none)"])].join("\n");
}

/** The records already on the plan, for the model: one line each with its id, name and figures. */
export function planView(records: ExistingRecords): string {
  const c = records.candidates;
  return [
    section("Accounts", c.accounts, (a) =>
      bits(`${a.id} ${a.name}`, a.category, a.custodian, a.accountNumberLast4 && `last 4 ${a.accountNumberLast4}`, `value ${money(a.value)}`, !!a.ownerNames?.length && `owners ${a.ownerNames.join(" / ")}`)),
    section("Liabilities", c.liabilities, (l) => bits(`${l.id} ${l.name}`, `balance ${money(l.balance)}`)),
    section("Incomes", c.incomes, (i) => bits(`${i.id} ${i.name}`, i.type, `owner ${i.owner}`)),
    section("Expenses", c.expenses, (e) => bits(`${e.id} ${e.name}`, e.type)),
    section("Living expense slots", c.livingSlots, (s) => bits(`${s.id} ${s.name}`, s.role)),
    section("Family members", c.familyMembers, (f) =>
      bits(`${f.id} ${[f.firstName, f.lastName].filter(Boolean).join(" ")}`, f.dateOfBirth && `born ${f.dateOfBirth}`)),
    section("Life policies", c.lifePolicies, (p) =>
      bits(`${p.id} ${p.carrier ?? "unknown carrier"}`, p.policyType, `insured ${p.insuredPerson}`, p.policyNumberLast4 && `policy last 4 ${p.policyNumberLast4}`, `face value ${money(p.faceValue)}`)),
    section("Wills", c.wills, (w) => bits(w.id, `grantor ${w.grantor}`)),
    section("Entities", c.entities, (e) => bits(`${e.id} ${e.name}`, e.entityType)),
    section("External beneficiaries", records.externalBeneficiaries, (b) => `${b.id} ${b.name}`),
    section("Disability policies", records.disabilityPolicies, (p) => bits(`${p.id} ${p.name}`, `insured ${p.insured}`, p.carrier)),
    section("Long-term-care policies", records.ltcPolicies, (p) => bits(`${p.id} ${p.name}`, `insured ${p.insured}`, p.carrier)),
    section("Gifts", records.gifts, (g) =>
      bits(g.id, String(g.year), `from ${g.grantor}`, `amount ${money(g.amount)}`, g.recipient && `to ${g.recipient.name}`)),
    section("Savings rules", records.savingsRules, (r) => bits(r.id, `account ${r.accountName} (${r.accountId})`)),
    section("Stock option grants", records.stockOptionGrants, (g) =>
      bits(`${g.id} ${g.accountName}`, g.grantNumber && `grant ${g.grantNumber}`, g.grantType, g.grantDate)),
    section("Notes receivable", records.notesReceivable, (n) => bits(`${n.id} ${n.name}`, `face value ${money(n.faceValue)}`)),
    section("Family (household roster)", c.family, (f) => bits(`${f.id} ${f.firstName} ${f.lastName ?? ""}`.trim(), f.role)),
  ].join("\n\n");
}
