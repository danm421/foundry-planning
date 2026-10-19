// src/lib/fact-finder/matching/score.ts
import type { ExtractedAccount, IncomeType, ExpenseType, LifePolicyType } from "@/lib/extraction/types";
import type { AccountCandidate } from "@/lib/imports/match-keys/account";
import { matchAccount, nameSimilarity } from "@/lib/imports/match-keys/account";
import { matchEntity } from "@/lib/imports/match-keys/entity";
import { matchExpense } from "@/lib/imports/match-keys/expense";
import { matchFamilyMember } from "@/lib/imports/match-keys/family-member";
import { matchIncome } from "@/lib/imports/match-keys/income";
import { matchLiability } from "@/lib/imports/match-keys/liability";
import { matchLifePolicy } from "@/lib/imports/match-keys/life-policy";
import type { MatchAnnotation } from "@/lib/imports/types";
import {
  EXPENSE_TYPE_MAP,
  GIFT_FROM_MAP,
  INCOME_OWNER_MAP,
  INCOME_TYPE_MAP,
  INSURED_MAP,
  LIFE_POLICY_TYPE_MAP,
  PERSON_MAP,
  SECTION_ACCOUNT_CATEGORY,
  valueFor,
} from "../enums";
import { custodiansAgree, grantTypesAgree, last4Of, normText } from "../identity";
import type { ExistingRecords } from "../records/types";
import { FACT_FINDER_SECTIONS, fixedLabelsOf, sectionsLinkingTo, type FFSection, type RecordKind } from "../schema";
import { fixedLabelOfRow, rowHasValues, rowValues, sameJson } from "../state";
import type { FactFinderState, FFCellValue, FFLink, FFLinkCandidate, FFRow } from "../types";

export const AUTO_LINK_SCORE = 0.9;
export const LINK_FLOOR = 0.45;
const MAX_CANDIDATES = 5;
/**
 * The most a candidate the row contradicts can score — another account or
 * policy number, another custodian or carrier, another date of birth. Still
 * offered (an account can move firms), but only ever as a suggestion: the old
 * matchers' fuzzy scores rank candidates, they never weigh a contradiction.
 */
const CONTRADICTED_SCORE = 0.6;

export interface ScoredCandidate {
  recordId: string;
  label: string;
  score: number;
  exact: boolean;
}

const str = (v: FFCellValue | undefined): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
const num = (v: FFCellValue | undefined): number | undefined => (typeof v === "number" ? v : undefined);
const opt = <T extends string>(v: string | null): T | undefined => (v === null ? undefined : (v as T));
const contradicted = (c: ScoredCandidate): ScoredCandidate => ({ ...c, score: Math.min(c.score, CONTRADICTED_SCORE), exact: false });
/** Both sides carry a number (last 4s) and they differ. */
const numbersDiffer = (a: string | undefined, b: string | null | undefined) => {
  const other = last4Of(b);
  return !!a && !!other && a !== other;
};

function fromAnnotation(match: MatchAnnotation, labelOf: (id: string) => string): ScoredCandidate[] {
  if (match.kind === "exact") return [{ recordId: match.existingId, label: labelOf(match.existingId), score: 1, exact: true }];
  if (match.kind === "fuzzy") return match.candidates.map((c) => ({ recordId: c.id, label: labelOf(c.id), score: c.score, exact: false }));
  return [];
}

function byName(name: string | undefined, pool: Array<{ id: string; name: string }>): ScoredCandidate[] {
  if (!name) return [];
  return pool.map((p) => {
    const exact = normText(p.name) === normText(name);
    return { recordId: p.id, label: p.name, score: exact ? 1 : nameSimilarity(name, p.name), exact };
  });
}

/** Share of the keys both sides have that agree. Null when fewer than two can be compared. */
function agreement(pairs: Array<[FFCellValue | undefined, string | number | null | undefined]>): { score: number; exact: boolean } | null {
  const present = pairs.filter(([a, b]) => normText(a) !== "" && normText(b ?? null) !== "");
  if (present.length < 2) return null;
  const agreed = present.filter(([a, b]) => normText(a) === normText(b ?? null)).length;
  return { score: agreed / present.length, exact: agreed === present.length };
}

const ACCOUNT_NAME: Record<string, string> = {
  cash: "accountName", taxable: "accountName", retirement: "accountName", edu: "accountName",
  annuity: "contractName", realestate: "propertyName", business: "businessName",
};

function ownerIdsFor(owner: string | undefined, family: ExistingRecords["candidates"]["family"]): string[] {
  const client = family.find((f) => f.role === "client")?.id;
  const spouse = family.find((f) => f.role === "spouse")?.id;
  const ids = owner === "Client" ? [client] : owner === "Co-client" ? [spouse] : owner === "Joint" ? [client, spouse] : [];
  return ids.filter((id): id is string => !!id);
}

function accountLabel(pool: AccountCandidate[], id: string): string {
  const a = pool.find((x) => x.id === id);
  if (!a) return id;
  return a.accountNumberLast4 ? `${a.name} ··${a.accountNumberLast4}` : a.name;
}

function scoreAccount(section: FFSection, v: Record<string, FFCellValue>, records: ExistingRecords): ScoredCandidate[] {
  const category = SECTION_ACCOUNT_CATEGORY[section.id as keyof typeof SECTION_ACCOUNT_CATEGORY];
  const name = str(v[ACCOUNT_NAME[section.id] ?? "accountName"]);
  const last4 = last4Of(v.last4) || undefined;
  if (!category || (!name && !last4)) return [];
  const pool = records.candidates.accounts.filter((a) => a.category !== "life_insurance" && a.category !== "stock_options");
  const custodian = str(v[section.id === "annuity" ? "carrier" : "custodian"]);
  const incoming: ExtractedAccount = {
    name: name ?? "",
    category,
    value: num(v[section.id === "annuity" ? "cashValue" : "currentValue"]),
    accountNumberLast4: last4,
    custodian,
  };
  return fromAnnotation(
    matchAccount(incoming, pool, ownerIdsFor(str(v.owner), records.candidates.family)),
    (id) => accountLabel(pool, id),
  ).map((c) => {
    const a = pool.find((x) => x.id === c.recordId);
    return numbersDiffer(last4, a?.accountNumberLast4) || !custodiansAgree(custodian, a?.custodian) ? contradicted(c) : c;
  });
}

function scoreLifePolicy(v: Record<string, FFCellValue>, records: ExistingRecords): ScoredCandidate[] {
  const pool = records.candidates.lifePolicies;
  const labelOf = (id: string) => {
    const p = pool.find((x) => x.id === id);
    return p ? [p.carrier ?? "Policy", p.policyNumberLast4 ? `··${p.policyNumberLast4}` : null].filter(Boolean).join(" ") : id;
  };
  const policyType = opt<LifePolicyType>(valueFor(LIFE_POLICY_TYPE_MAP, str(v.policyType)));
  const insured = opt<"client" | "spouse" | "joint">(valueFor(INSURED_MAP, str(v.insured)));
  const face = num(v.deathBenefit);
  const carrier = str(v.carrier);
  const last4 = last4Of(v.policyNumber) || undefined;
  if (policyType && insured && face !== undefined) {
    return fromAnnotation(
      matchLifePolicy(
        { carrier, policyNumberLast4: last4, policyType, insuredPerson: insured, faceValue: face, accountName: str(v.policyName) ?? "" },
        pool,
      ),
      labelOf,
    ).map((c) => {
      const p = pool.find((x) => x.id === c.recordId);
      return numbersDiffer(last4, p?.policyNumberLast4) || !custodiansAgree(carrier, p?.carrier) ? contradicted(c) : c;
    });
  }
  if (!carrier || !last4) return [];
  return pool
    .filter((p) => normText(p.carrier) === normText(carrier) && p.policyNumberLast4 === last4)
    .map((p) => ({ recordId: p.id, label: labelOf(p.id), score: 1, exact: true }));
}

function scoreByKind(kind: RecordKind, section: FFSection, v: Record<string, FFCellValue>, records: ExistingRecords): ScoredCandidate[] {
  const c = records.candidates;
  switch (kind) {
    case "account":
      return scoreAccount(section, v, records);
    case "liability": {
      const name = str(v.loanName);
      if (!name) return [];
      return fromAnnotation(matchLiability({ name, balance: num(v.balance) }, c.liabilities), (id) => c.liabilities.find((l) => l.id === id)?.name ?? id);
    }
    case "familyMember": {
      const firstName = str(v.firstName);
      if (!firstName) return [];
      const household = new Set(c.family.filter((f) => f.role === "client" || f.role === "spouse").map((f) => f.id));
      const pool = c.familyMembers.filter((f) => !household.has(f.id));
      const dateOfBirth = str(v.dateOfBirth);
      return fromAnnotation(
        matchFamilyMember({ firstName, lastName: str(v.lastName), dateOfBirth }, pool),
        (id) => {
          const f = pool.find((x) => x.id === id);
          return f ? [f.firstName, f.lastName].filter(Boolean).join(" ") : id;
        },
      ).map((cand) => {
        const other = pool.find((x) => x.id === cand.recordId)?.dateOfBirth;
        return dateOfBirth && other && other !== dateOfBirth ? contradicted(cand) : cand;
      });
    }
    case "lifePolicy":
      return scoreLifePolicy(v, records);
    case "entity": {
      const name = str(v.trustName);
      if (!name) return [];
      // Trusts only: the review's link check accepts a trust (matchEntity's exact match ignores the type).
      const trusts = c.entities.filter((e) => e.entityType === "trust");
      return fromAnnotation(matchEntity({ name, entityType: "trust" }, trusts), (id) => trusts.find((e) => e.id === id)?.name ?? id);
    }
    case "income": {
      const name = str(v.incomeName);
      if (!name) return [];
      const pool = c.incomes.filter((i) => i.type !== "salary" && i.type !== "social_security");
      return fromAnnotation(
        matchIncome(
          {
            name,
            type: opt<IncomeType>(valueFor(INCOME_TYPE_MAP, str(v.type))),
            owner: opt<"client" | "spouse" | "joint">(valueFor(INCOME_OWNER_MAP, str(v.owner))),
          },
          pool,
        ),
        (id) => pool.find((i) => i.id === id)?.name ?? id,
      );
    }
    case "expense": {
      const name = str(v.expenseName);
      if (!name) return [];
      const slots = new Set(c.livingSlots.map((s) => s.id));
      const pool = c.expenses.filter((e) => !slots.has(e.id));
      return fromAnnotation(
        matchExpense({ name, type: opt<ExpenseType>(valueFor(EXPENSE_TYPE_MAP, str(v.type))) }, pool),
        (id) => pool.find((e) => e.id === id)?.name ?? id,
      );
    }
    case "savingsRule":
      return byName(str(v.account), records.savingsRules.map((r) => ({ id: r.id, name: r.accountName })));
    case "externalBeneficiary":
      return byName(str(v.name), records.externalBeneficiaries);
    case "noteReceivable":
      return byName(str(v.borrower), records.notesReceivable);
    case "disabilityPolicy":
    case "ltcPolicy": {
      const pool = kind === "disabilityPolicy" ? records.disabilityPolicies : records.ltcPolicies;
      const insured = valueFor(PERSON_MAP, str(v.whoIsCovered));
      return pool.flatMap((p): ScoredCandidate[] => {
        const a = agreement([[v.policyName, p.name], [insured, p.insured], [v.carrier, p.carrier]]);
        return a ? [{ recordId: p.id, label: p.name, score: a.score, exact: a.exact }] : [];
      });
    }
    case "gift": {
      const year = num(v.year);
      const from = valueFor(GIFT_FROM_MAP, str(v.from));
      const amount = num(v.amount);
      return records.gifts.flatMap((g): ScoredCandidate[] => {
        const checks: boolean[] = [];
        if (year !== undefined) checks.push(g.year === year);
        if (from) checks.push(g.grantor === from);
        if (amount !== undefined && g.amount !== null) {
          checks.push(Math.abs(g.amount - amount) <= Math.max(1, Math.abs(g.amount) * 0.01));
        }
        if (checks.length < 2) return [];
        const agreed = checks.filter(Boolean).length;
        const label = g.amount !== null ? `${g.year} gift of $${g.amount.toLocaleString("en-US")}` : `${g.year} gift`;
        return [{ recordId: g.id, label, score: agreed / checks.length, exact: agreed === checks.length }];
      });
    }
    case "stockOptionGrant": {
      const grantNumber = str(v.grantNumber);
      const company = str(v.company);
      const grantDate = str(v.grantDate);
      return records.stockOptionGrants.flatMap((g): ScoredCandidate[] => {
        const label = `${g.accountName} ${g.grantType.toUpperCase()} ${g.grantDate}`;
        // An RSU and an NQSO granted the same day are two grants.
        if (!grantTypesAgree(v.grantType, g.grantType)) return [];
        if (grantNumber && g.grantNumber) {
          return normText(grantNumber) === normText(g.grantNumber) ? [{ recordId: g.id, label, score: 1, exact: true }] : [];
        }
        if (!company) return [];
        const score = 0.5 * nameSimilarity(company, g.accountName) + (grantDate && grantDate === g.grantDate ? 0.5 : 0);
        return [{ recordId: g.id, label, score, exact: false }];
      });
    }
  }
}

/** Candidates for one row, best first: exact matches, then by score; at most five, none below the floor. */
export function scoreCandidates(section: FFSection, row: FFRow, records: ExistingRecords): ScoredCandidate[] {
  if (!section.links) return [];
  return scoreByKind(section.links, section, rowValues(row), records)
    .filter((c) => c.exact || c.score >= LINK_FLOOR)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
    .slice(0, MAX_CANDIDATES);
}

/** Rescore only rows nobody has ruled on: no link, an unconfirmed one, or an automatic New. */
function needsScoring(row: FFRow): boolean {
  const link = row.link;
  if (!link) return true;
  if (link.kind === "existing") return !link.confirmed;
  return link.by === "auto";
}

/**
 * Links for one record kind's rows, in two passes so neither row order nor a
 * second run changes the result. First every automatic confirm settles: only a
 * row's best candidate can auto-confirm, exact before fuzzy, then by score,
 * ties in section and row order. Then each other row — including one whose best
 * candidate another row took — suggests its best unclaimed candidate ("needs a
 * click"), or says New.
 */
function pickLinks(scoredRows: ScoredCandidate[][], claimed: Set<string>): FFLink[] {
  const confirmed: Array<FFLink | undefined> = [];
  const autos = scoredRows
    .flatMap((scored, i) => {
      const best = scored[0];
      return best && (best.exact || best.score >= AUTO_LINK_SCORE) ? [{ i, c: best }] : [];
    })
    .sort((a, b) => Number(b.c.exact) - Number(a.c.exact) || b.c.score - a.c.score);
  for (const { i, c } of autos) {
    if (claimed.has(c.recordId)) continue;
    claimed.add(c.recordId);
    confirmed[i] = { kind: "existing", recordId: c.recordId, score: c.score, confirmed: true, by: "auto" };
  }
  return scoredRows.map((scored, i): FFLink => {
    if (confirmed[i]) return confirmed[i];
    if (scored.length === 0) return { kind: "new", by: "auto" };
    const pick = scored.find((c) => !claimed.has(c.recordId)) ?? scored[0];
    return { kind: "existing", recordId: pick.recordId, score: pick.score, confirmed: false, by: "auto" };
  });
}

function withLink(row: FFRow, link: FFLink, scored: ScoredCandidate[]): FFRow {
  const linkCandidates: FFLinkCandidate[] = scored.map(({ recordId, label, score }) => ({ recordId, label, score }));
  if (sameJson(row.link ?? null, link) && sameJson(row.linkCandidates ?? [], linkCandidates)) return row;
  return { ...row, link, linkCandidates };
}

const PERSON_OF_ROW: Record<string, "client" | "spouse"> = { Client: "client", "Co-client": "spouse" };

/** Fixed rows link to the record that plays their role — there's no picker to choose among. */
const IMPLICIT: Record<string, (label: string, r: ExistingRecords) => Array<{ id: string; label: string }>> = {
  salary: (label, r) =>
    r.candidates.incomes.filter((i) => i.type === "salary" && i.owner === PERSON_OF_ROW[label]).map((i) => ({ id: i.id, label: i.name })),
  ss: (label, r) =>
    r.candidates.incomes
      .filter((i) => i.type === "social_security" && i.owner === PERSON_OF_ROW[label])
      .map((i) => ({ id: i.id, label: i.name })),
  living: (label, r) =>
    r.candidates.livingSlots
      .filter((s) => s.role === (label === "Current" ? "current" : "retirement"))
      .map((s) => ({ id: s.id, label: s.name })),
};

/** Records a live row of this kind already confirms. Removed-tray rows hold no claim here. */
function liveClaims(sections: Record<string, FFRow[]>, kind: RecordKind): Set<string> {
  const claimed = new Set<string>();
  for (const s of sectionsLinkingTo(kind)) {
    for (const r of sections[s.id] ?? []) if (r.link?.kind === "existing" && r.link.confirmed) claimed.add(r.link.recordId);
  }
  return claimed;
}

/** A fixed row's candidates: the one record that plays its role is exact; several are a toss-up. Null = not a fixed row. */
function implicitCandidates(section: FFSection, row: FFRow, records: ExistingRecords): ScoredCandidate[] | null {
  const implicit = IMPLICIT[section.id];
  const label = fixedLabelOfRow(section.id, row.id);
  if (!implicit || !label) return null;
  const found = implicit(label, records);
  return found.map((f) => ({ recordId: f.id, label: f.label, score: found.length === 1 ? 1 : 0.5, exact: found.length === 1 }));
}

export function applyLinkScores(state: FactFinderState, records: ExistingRecords): FactFinderState {
  let sections = state.sections;
  const kinds = [...new Set(FACT_FINDER_SECTIONS.flatMap((s) => (s.links ? [s.links] : [])))];

  for (const kind of kinds) {
    const pending: Array<{ sectionId: string; index: number; row: FFRow; scored: ScoredCandidate[] }> = [];
    for (const s of sectionsLinkingTo(kind)) {
      const fixed = fixedLabelsOf(s).length > 0;
      (sections[s.id] ?? []).forEach((row, index) => {
        if (!needsScoring(row) || !rowHasValues(row)) return;
        const scored = fixed ? implicitCandidates(s, row, records) : scoreCandidates(s, row, records);
        if (scored) pending.push({ sectionId: s.id, index, row, scored });
      });
    }
    const links = pickLinks(pending.map((p) => p.scored), liveClaims(sections, kind));
    pending.forEach(({ sectionId, index, row, scored }, i) => {
      const next = withLink(row, links[i], scored);
      if (next === row) return;
      const rows = [...sections[sectionId]];
      rows[index] = next;
      sections = { ...sections, [sectionId]: rows };
    });
  }

  return sections === state.sections ? state : { ...state, sections };
}
