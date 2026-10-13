// src/lib/fact-finder/placement/refs.ts
/**
 * Free text that names something — a savings "Account", "Mortgage on it", a
 * rider's life policy, a beneficiary, the trust that owns an account — turned
 * into what it names (D6). The fact finder's own live rows come first (a row
 * whose link is confirmed stands for that record, any other row for the line it
 * creates), then the client's base-case records. A name matches whole
 * (normText); an account or a life policy also by its last 4; a family member
 * by a first name no one else has. Nothing matching, or two things, is a reason
 * the line can't save — never a guess, and never a new person or trust. Pure.
 */
import { lineIdOf, type RecordRef, type TargetKind } from "../change-set";
import { SECTION_ACCOUNT_CATEGORY } from "../enums";
import { last4Of, normText } from "../identity";
import { matchOption } from "../normalize";
import { OWNER_PERSON } from "../schema";
import { fixedRowId, rowHasValues } from "../state";
import type { FactFinderState, FFRow } from "../types";
import type { BookRecord, RecordBook } from "./types";

/** Something a name can resolve to. */
interface Entry {
  ref: RecordRef;
  label: string;
  /** Whole names it answers to, normText'd. */
  names: string[];
  /** A family member's first name, normText'd. */
  first?: string;
  last4?: string;
  /** Custodian or carrier, normText'd: tells two accounts with one last 4 apart. */
  issuer?: string;
  /** Accounts: the fact finder section it is (or would be) in. */
  section?: string;
}

/** The fact finder's live rows, then the book's records. */
type Tiers = readonly [rows: readonly Entry[], book: readonly Entry[]];

/** Built once per review by buildRefIndex; read it only through the functions below. */
export interface RefIndex {
  readonly state: FactFinderState;
  readonly book: RecordBook;
  readonly accounts: Tiers;
  readonly liabilities: Tiers;
  readonly lifePolicies: Tiers;
  readonly trusts: Tiers;
  readonly family: Tiers;
  readonly external: Tiers;
  /** The client, and the co-client when there is one. */
  readonly household: readonly Entry[];
  readonly coClient: boolean;
  /** Revocable living trusts' names: not something an account, a beneficiary or a gift can name. */
  readonly revocable: ReadonlySet<string>;
}

export type RefResult = { ok: true; ref: RecordRef; label: string } | { ok: false; reason: string };
export type PersonKind = "household" | "family" | "external" | "trust";

export const NO_CO_CLIENT_REASON = "Add the co-client on the Household page first.";

/** Each account section's name column. A real estate row also answers to its address. */
const ACCOUNT_NAME: Record<string, string> = {
  cash: "accountName", taxable: "accountName", retirement: "accountName", annuity: "contractName",
  edu: "accountName", realestate: "propertyName", business: "businessName",
};
const SECTION_OF_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(SECTION_ACCOUNT_CATEGORY).map(([section, category]) => [category, section]),
);
const REVOCABLE = "Revocable living trust";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const cell = (row: FFRow | undefined, columnId: string) => str(row?.cells[columnId]?.value);
const namesOf = (...values: (string | null)[]) => values.map((v) => normText(v)).filter(Boolean);
const last4 = (v: string | null) => last4Of(v) || undefined;
const norm = (v: string | null) => normText(v) || undefined;
const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ");

/**
 * A live row's record: its confirmed link when this book has it, else (New, no
 * link) the line it creates. Null for a link the review settles first (D11).
 */
function refOfRow(book: RecordBook, row: FFRow, target: TargetKind): RecordRef | null {
  const link = row.link;
  if (link?.kind !== "existing") return { ref: "line", target, lineId: lineIdOf(row.id, target) };
  if (!link.confirmed || !book.records[target].some((r) => r.id === link.recordId)) return null;
  return { ref: "record", target, id: link.recordId };
}

export function buildRefIndex(state: FactFinderState, book: RecordBook): RefIndex {
  const live = (sectionId: string) => (state.sections[sectionId] ?? []).filter(rowHasValues);
  const fromRows = (rows: FFRow[], target: TargetKind, read: (row: FFRow) => Omit<Entry, "ref">): Entry[] =>
    rows.flatMap((row) => {
      const ref = refOfRow(book, row, target);
      return ref ? [{ ref, ...read(row) }] : [];
    });
  const fromBook = (target: TargetKind, read: (r: BookRecord) => Omit<Entry, "ref">): Entry[] =>
    book.records[target].map((r) => ({ ref: { ref: "record", target, id: r.id }, ...read(r) }));
  const named = (r: BookRecord) => ({ label: r.label, names: namesOf(str(r.values.name)) });

  const accountRows = Object.entries(ACCOUNT_NAME).flatMap(([section, nameColumn]) =>
    fromRows(live(section), section === "business" ? "business_account" : "account", (row) => {
      const name = cell(row, nameColumn);
      const address = section === "realestate" ? cell(row, "address") : null;
      const l4 = last4(cell(row, "last4"));
      return {
        label: [name ?? address ?? "Account", l4 && `··${l4}`].filter(Boolean).join(" "),
        names: namesOf(name, address),
        last4: l4,
        issuer: norm(cell(row, section === "annuity" ? "carrier" : "custodian")),
        section,
      };
    }),
  );
  const accountBook = [
    ...fromBook("account", (r) => {
      const section = SECTION_OF_CATEGORY[String(r.facts?.category)];
      return {
        label: r.label,
        names: namesOf(str(r.values.name), section === "realestate" ? str(r.values.propertyAddress) : null),
        last4: last4(str(r.values.accountNumberLast4)),
        issuer: norm(str(r.values.custodian)),
        section,
      };
    }),
    ...fromBook("business_account", (r) => ({ ...named(r), section: "business" })),
  ];

  const trustRows = live("trusts");
  const isRevocable = (row: FFRow) => cell(row, "trustType") === REVOCABLE;

  // The household's names: the fact finder's Client & Co-client rows first, else the plan's.
  const onRecord = book.records.client_household[0]?.values ?? {};
  const peopleRow = (label: string) => (state.sections.people ?? []).find((r) => r.id === fixedRowId("people", label));
  const person = (role: "client" | "spouse"): Entry => {
    const row = peopleRow(role === "client" ? "Client" : "Co-client");
    const first = cell(row, "firstName") ?? book.names[role];
    const last = cell(row, "lastName") ?? str(onRecord[role === "client" ? "lastName" : "spouseLastName"]);
    const full = first ? fullName(first, last) : null;
    return { ref: { ref: "person", role }, label: full ?? (role === "client" ? "Client" : "Co-client"), names: namesOf(first, full) };
  };
  const coClient = book.people.spouse !== null || book.names.spouse !== null || cell(peopleRow("Co-client"), "firstName") !== null;

  return {
    state,
    book,
    accounts: [accountRows, accountBook],
    liabilities: [
      fromRows(live("liab"), "liability", (row) => ({ label: cell(row, "loanName") ?? "Loan", names: namesOf(cell(row, "loanName")) })),
      fromBook("liability", named),
    ],
    lifePolicies: [
      fromRows(live("life"), "life_insurance_policy", (row) => {
        const l4 = last4(cell(row, "policyNumber"));
        return {
          label: cell(row, "policyName") ?? [cell(row, "carrier") ?? "Policy", l4 && `··${l4}`].filter(Boolean).join(" "),
          names: namesOf(cell(row, "policyName")),
          last4: l4,
          issuer: norm(cell(row, "carrier")),
        };
      }),
      fromBook("life_insurance_policy", (r) => ({
        ...named(r),
        last4: last4(str(r.values.policyNumberLast4)),
        issuer: norm(str(r.values.carrier)),
      })),
    ],
    trusts: [
      fromRows(trustRows.filter((row) => !isRevocable(row)), "entity", (row) => ({
        label: cell(row, "trustName") ?? "Trust",
        names: namesOf(cell(row, "trustName")),
      })),
      fromBook("entity", named),
    ],
    family: [
      fromRows(live("family"), "family_member", (row) => {
        const name = fullName(cell(row, "firstName"), cell(row, "lastName"));
        return { label: name || "Family member", names: namesOf(name), first: norm(cell(row, "firstName")) };
      }),
      fromBook("family_member", (r) => ({
        label: r.label,
        names: namesOf(fullName(str(r.values.firstName), str(r.values.lastName))),
        first: norm(str(r.values.firstName)),
      })),
    ],
    external: [
      fromRows(live("external"), "external_beneficiary", (row) => ({ label: cell(row, "name") ?? "Beneficiary", names: namesOf(cell(row, "name")) })),
      fromBook("external_beneficiary", named),
    ],
    household: coClient ? [person("client"), person("spouse")] : [person("client")],
    coClient,
    revocable: new Set([
      ...trustRows.filter(isRevocable).flatMap((row) => namesOf(cell(row, "trustName"))),
      ...book.records.revocable_trust.flatMap((r) => namesOf(str(r.values.name))),
    ]),
  };
}

/** One tier's hits: whole names, else last 4 (two of one last 4 told apart by the words around it), else a first name. */
function matches(tier: readonly Entry[], q: string, l4: string, firstName: boolean): Entry[] {
  if (q === "") return [];
  const byName = tier.filter((e) => e.names.includes(q));
  if (byName.length > 0) return byName;
  if (l4) {
    const byLast4 = tier.filter((e) => e.last4 === l4);
    const told = byLast4.filter((e) => [e.issuer, ...e.names].some((w) => w && ` ${q} `.includes(` ${w} `)));
    if (byLast4.length > 0) return told.length > 0 ? told : byLast4;
  }
  return firstName ? tier.filter((e) => e.first === q) : [];
}

/** The hits of the first tier that has any — so a fact finder row beats a record of the same name. */
function hitsFor(tiers: readonly (readonly Entry[])[], text: string, by: { last4?: true; firstName?: true } = {}): Entry[] {
  const q = normText(text);
  const l4 = by.last4 && /\d{4}/.test(text) ? last4Of(text) : "";
  for (const tier of tiers) {
    const hits = matches(tier, q, l4, by.firstName === true);
    if (hits.length > 0) return hits;
  }
  return [];
}

interface Noun { one: string; many: string; hint: string }
const ACCOUNT: Noun = { one: "account", many: "accounts", hint: "use the name or last 4" };
const PROPERTY: Noun = { one: "property", many: "properties", hint: "use the property's name or address" };
const LOAN: Noun = { one: "loan", many: "loans", hint: "use the loan's full name" };
const POLICY: Noun = { one: "life policy", many: "life policies", hint: "use the policy name, or the carrier and last 4" };
const TRUST: Noun = { one: "trust or entity", many: "trusts", hint: "use the trust's full name" };
const PERSON: Noun = { one: "one", many: "people", hint: "use the full name" };

function result(hits: Entry[], text: string, noun: Noun): RefResult {
  const quoted = `"${text.trim()}"`;
  if (hits.length === 1) return { ok: true, ref: hits[0].ref, label: hits[0].label };
  if (hits.length > 1) return { ok: false, reason: `${hits.length === 2 ? "Two" : hits.length} ${noun.many} match ${quoted} — ${noun.hint}.` };
  return { ok: false, reason: `No ${noun.one} named ${quoted} in this fact finder or on the plan.` };
}

const revocableReason = (text: string) => `"${text.trim()}" is a revocable living trust, which can't be named here.`;

function inSections(tiers: Tiers, sections: readonly string[] | undefined): Tiers {
  if (!sections) return tiers;
  const keep = (e: Entry) => e.section !== undefined && sections.includes(e.section);
  return [tiers[0].filter(keep), tiers[1].filter(keep)];
}

/** The record a live row stands for: its confirmed link if that record is in the book, else the line it creates. */
export function rowRecordRef(index: RefIndex, sectionId: string, rowId: string, target: TargetKind): RecordRef | null {
  const row = (index.state.sections[sectionId] ?? []).find((r) => r.id === rowId);
  return row && rowHasValues(row) ? refOfRow(index.book, row, target) : null;
}

/** Name or last 4, across the account sections (cash taxable retirement annuity edu realestate business) and the book's accounts and businesses. */
export function findAccount(index: RefIndex, text: string, opts: { sections?: readonly string[] } = {}): RefResult {
  return result(hitsFor(inSections(index.accounts, opts.sections), text, { last4: true }), text, ACCOUNT);
}

/** Real estate rows (name or address) and the book's real estate accounts. */
export function findProperty(index: RefIndex, text: string): RefResult {
  return result(hitsFor(inSections(index.accounts, ["realestate"]), text), text, PROPERTY);
}

export function findLiability(index: RefIndex, text: string): RefResult {
  return result(hitsFor(index.liabilities, text), text, LOAN);
}

/** Life rows (name, or carrier and last 4) and the book's policies. */
export function findLifePolicy(index: RefIndex, text: string): RefResult {
  return result(hitsFor(index.lifePolicies, text, { last4: true }), text, POLICY);
}

/** Trusts rows (not revocable) and the book's entities. */
export function findTrust(index: RefIndex, text: string): RefResult {
  const hits = hitsFor(index.trusts, text);
  if (hits.length === 0 && index.revocable.has(normText(text))) return { ok: false, reason: revocableReason(text) };
  return result(hits, text, TRUST);
}

export function householdPerson(index: RefIndex, role: "client" | "spouse"): RecordRef {
  return { ref: "person", role };
}

/** The plan has a co-client, or the fact finder names one (the Co-client row's first name). */
export function hasCoClient(index: RefIndex): boolean {
  return index.coClient;
}

const ROLE_OF: Record<string, "client" | "spouse"> = { Client: "client", "Co-client": "spouse" };

/**
 * A person, charity or trust: the role words ("Client", "Co-client", and what
 * documents print for them), the client's and co-client's first or full names,
 * then family members, charities and trusts — only the kinds `allow` lists.
 */
export function findPerson(index: RefIndex, text: string, opts: { allow: readonly PersonKind[] }): RefResult {
  const allow = new Set(opts.allow);
  const role = ROLE_OF[matchOption(text, OWNER_PERSON) ?? ""];
  const principal = index.household.find((e) => e.ref.ref === "person" && e.ref.role === role);
  if (role && allow.has("household")) {
    return principal ? { ok: true, ref: householdPerson(index, role), label: principal.label } : { ok: false, reason: NO_CO_CLIENT_REASON };
  }

  const tier = (i: 0 | 1) => [
    ...(allow.has("household") && i === 0 ? index.household : []),
    ...(allow.has("family") ? index.family[i] : []),
    ...(allow.has("external") ? index.external[i] : []),
    ...(allow.has("trust") ? index.trusts[i] : []),
  ];
  const hits = hitsFor([tier(0), tier(1)], text, { firstName: true });
  if (hits.length > 0) return result(hits, text, PERSON);

  // Nobody it may name: say so when the text is someone it can't name here.
  if (role) return { ok: false, reason: `The ${role === "client" ? "client" : "co-client"} can't be named here.` };
  const named = index.household.find((e) => e.names.includes(normText(text)));
  if (named?.ref.ref === "person") {
    return { ok: false, reason: `"${text.trim()}" is the ${named.ref.role === "client" ? "client" : "co-client"}, who can't be named here.` };
  }
  if (index.revocable.has(normText(text))) return { ok: false, reason: revocableReason(text) };
  return result([], text, PERSON);
}
