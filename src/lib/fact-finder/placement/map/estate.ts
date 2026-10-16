// src/lib/fact-finder/placement/map/estate.ts
/**
 * The Estate page (D4, D7): Documents in Place (a will to create, the "last
 * updated" plan note, the estate attorney, a notice for a trust it names that
 * the Trusts section doesn't), trusts and their beneficiaries, will provisions
 * under one will per person, prior gifts, and the closing notes box (the AI
 * step places it). Wills, provisions, the attorney and plan notes have no
 * "Links to": they find their record on the plan by who and what (D8). Pure.
 */
import { lineIdOf, refKey, type CellRef, type PlacedValue, type RecordRef } from "../../change-set";
import {
  BEQUEST_COND_MAP, BEQUEST_KIND_MAP, GIFT_FROM_MAP, PERSON_MAP, TRUST_ENDS_MAP, TRUST_GRANTOR_MAP, TRUST_TYPE_MAP, valueFor,
} from "../../enums";
import { normText } from "../../identity";
import { fixedRow, fixedRowId } from "../../state";
import type { FFRow } from "../../types";
import { findAccount, findLiability, findPerson, type RefResult } from "../refs";
import { roleLabel, willLabel } from "../text";
import { parseShares, splitPersonName } from "../translate";
import { findRecord, type TargetDraft } from "../types";
import {
  beneficiariesOf, bool, cellOf, DraftBuilder, linkedRecordId, needsCoClient, num, planNoteDraft, putOrDefault, quotedLabels, sharesOf, text,
} from "./helpers";
import type { PlaceContext, SectionMap } from "./types";

type Person = "client" | "spouse";
const PEOPLE: readonly Person[] = ["client", "spouse"];

/** A value on record that reads as this text. */
const sameText = (value: PlacedValue | undefined, s: string) => typeof value === "string" && normText(value) === normText(s);

// ---- wills ------------------------------------------------------------------------

/** The person's Documents in Place row (an empty one when the fact finder has none). */
function docsRow(ctx: PlaceContext, person: Person): FFRow {
  return fixedRow(ctx.state, "estate_docs", roleLabel(person)) ?? { id: fixedRowId("estate_docs", roleLabel(person)), cells: {}, sourceFileIds: [] };
}
const personOfDocsRow = (row: FFRow) => PEOPLE.find((p) => fixedRowId("estate_docs", roleLabel(p)) === row.id);

/** Will Provisions rows that name this person's will. */
const provisionsOf = (rows: readonly FFRow[], person: Person) => rows.filter((r) => valueFor(PERSON_MAP, text(r, "willOf")) === person);

interface Will { ref: RecordRef; recordId: string | null; label: string }

/**
 * The person's will: the one on record (D8: by grantor), else the will line on
 * their Documents in Place row — whichever section asks for it, so a person
 * never gets two.
 */
function willOf(ctx: PlaceContext, person: Person): Will {
  const onRecord = ctx.book.records.will.find((r) => r.facts?.grantor === person);
  if (onRecord) return { ref: { ref: "record", target: "will", id: onRecord.id }, recordId: onRecord.id, label: onRecord.label };
  const people = fixedRow(ctx.state, "people", roleLabel(person));
  const first = (people ? text(people, "firstName") : null) ?? ctx.book.names[person];
  return {
    ref: { ref: "line", target: "will", lineId: lineIdOf(docsRow(ctx, person).id, "will") },
    recordId: null,
    label: willLabel(first, person),
  };
}

/** A will to create (its grantor is all it holds), from the cells that say the person has one. */
function newWill(ctx: PlaceContext, person: Person, will: Will, from: CellRef[]): TargetDraft {
  const b = new DraftBuilder({ sectionId: "estate_docs", row: docsRow(ctx, person), target: "will", recordId: null, label: will.label })
    .put("grantor", person, from);
  needsCoClient(b, ctx, person, from[0]);
  return b.build();
}

// ---- Documents in Place -----------------------------------------------------------------

/** The trust checks: what each says, and the trust type the Trusts section (or the plan) would have. */
const TRUST_CHECKS = [
  ["revocableTrust", "a revocable living trust", "revocable"],
  ["ilit", "an ILIT", "ilit"],
  ["idgt", "an IDGT", "idgt"],
  ["clt", "a CLT", "clt"],
  ["crt", "a CRT", "crt"],
  ["otherIrrevocable", "an irrevocable trust", "irrevocable"],
] as const;
const TRUST_CHECK = "A trust is created from the Trusts section, which names it.";

/** A trust checked here that neither the Trusts section nor the plan has: a notice, never a line. */
function noticeMissingTrusts(rows: readonly FFRow[], ctx: PlaceContext): void {
  const known = new Set<unknown>([
    ...(ctx.state.sections.trusts ?? []).map((r) => valueFor(TRUST_TYPE_MAP, text(r, "trustType"))),
    ...ctx.book.records.entity.map((r) => r.facts?.trustSubType),
    ...(ctx.book.records.revocable_trust.length > 0 ? ["revocable"] : []),
  ]);
  for (const [columnId, what, type] of TRUST_CHECKS) {
    if (known.has(type)) continue;
    const who = rows.filter((r) => bool(r, columnId) === true).flatMap((r) => personOfDocsRow(r) ?? []);
    if (who.length === 0) continue;
    const subject = who.length > 1 ? "the client and co-client have" : who[0] === "spouse" ? "the co-client has" : "the client has";
    ctx.notice(`Documents in Place says ${subject} ${what}, but the Trusts section lists none — add it there to save it.`);
  }
}

/** "Last updated (year)" → a plan note (D7), never an invented execution date. The same note on record is that record. */
function lastUpdatedNote(row: FFRow, ctx: PlaceContext, person: Person, year: number): TargetDraft {
  const body = bool(row, "will") === true
    ? `${roleLabel(person)}'s will was last updated in ${year}.`
    : `${roleLabel(person)}'s estate documents were last updated in ${year}.`;
  return planNoteDraft("estate_docs", row, ctx, { label: `Plan note: ${body}`, topic: "estate", body, columns: ["lastUpdatedYear"] });
}

/** Credentials and suffixes are neither a name nor a firm ("Jane Smith, Esq."). */
const SUFFIX = /^(esq|jr|sr|ii|iii|iv)\.?$/i;

/** What makes a name a firm's ("Smith & Co", "Baker McKenzie LLP", "Law Offices of…", "Jane Smith (Smith & Co)"). */
const FIRM_MARKER = /[&()[\]]|\b(?:llp|llc|pllc|pc|p\.c|p\.a|law|associates|group|firm|of)\b/i;
const NEEDS_ATTORNEY_NAME = "Estate attorney: give the attorney's first and last name.";

/**
 * "Jane Smith, Smith & Co" → the name before the first comma, and the firm
 * after it. A name that reads as a firm is no person's: the whole text is the
 * firm, and the name is left for the advisor to give.
 */
function readAttorney(value: string): { name: string | null; firm: string | null } {
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p !== "" && !SUFFIX.test(p));
  const name = (parts[0] ?? "").split(/\s+/).filter((w) => !SUFFIX.test(w)).join(" ");
  if (FIRM_MARKER.test(name)) return { name: null, firm: value };
  return { name, firm: parts.slice(1).join(", ") || null };
}

/** The estate attorney, once for the household: both people naming one attorney make one line, from both cells. */
function attorneyDrafts(rows: readonly FFRow[], ctx: PlaceContext): TargetDraft[] {
  const named = new Map<string, { row: FFRow; name: string | null; firm: string | null; cells: CellRef[]; firmCells: CellRef[] }>();
  for (const row of rows) {
    const value = text(row, "estateAttorney");
    if (value === null) continue;
    const { name, firm } = readAttorney(value);
    const cell = cellOf("estate_docs", row, "estateAttorney");
    const key = normText(name ?? firm);
    const entry = named.get(key) ?? { row, name, firm: null, cells: [], firmCells: [] };
    entry.cells.push(cell);
    if (firm !== null) {
      entry.firm ??= firm;
      entry.firmCells.push(cell);
    }
    named.set(key, entry);
  }
  return [...named.values()].map(({ row, name, firm, cells, firmCells }) => {
    const split = name === null ? null : splitPersonName(name);
    const recordId = split === null
      ? null
      : ctx.book.records.related_party.find((r) => sameText(r.values.firstName, split.firstName) && sameText(r.values.lastName, split.lastName))?.id ?? null;
    const b = new DraftBuilder({
      sectionId: "estate_docs", row, target: "related_party", recordId,
      label: name || firm ? `Estate attorney — ${name || firm}` : "Estate attorney",
      fixed: { relationshipLabel: "Estate attorney" },
    });
    // Never a made-up person: with no first and last name (one word, or only a firm) the firm is kept and the name is the advisor's to give.
    if (split === null) return b.put("employer", firm, firmCells).block(NEEDS_ATTORNEY_NAME, cells[0]).build();
    return b.put("firstName", split.firstName, cells).put("lastName", split.lastName, cells).put("employer", firm, firmCells).build();
  });
}

export const ESTATE_DOCS_MAP: SectionMap = {
  sectionId: "estate_docs",
  placements: {
    will: { to: "will.grantor" },
    revocableTrust: { context: TRUST_CHECK },
    ilit: { context: TRUST_CHECK },
    idgt: { context: TRUST_CHECK },
    clt: { context: TRUST_CHECK },
    crt: { context: TRUST_CHECK },
    otherIrrevocable: { context: TRUST_CHECK },
    lastUpdatedYear: { to: "plan_observation.body" },
    // "Jane Smith, Smith & Co" → firstName + lastName, and the firm as employer.
    estateAttorney: { to: "related_party.firstName" },
  },
  place(rows, ctx) {
    const drafts: TargetDraft[] = [];
    for (const row of rows) {
      const person = personOfDocsRow(row);
      if (!person) continue;
      // With Will Provisions rows for this person, that map makes the will (this check among its cells).
      if (bool(row, "will") === true && provisionsOf(ctx.state.sections.bequests ?? [], person).length === 0) {
        const will = willOf(ctx, person);
        if (will.recordId === null) drafts.push(newWill(ctx, person, will, [cellOf("estate_docs", row, "will")]));
      }
      const year = num(row, "lastUpdatedYear");
      if (year !== null) drafts.push(lastUpdatedNote(row, ctx, person, year));
    }
    noticeMissingTrusts(rows, ctx);
    return [...drafts, ...attorneyDrafts(rows, ctx)];
  },
};

// ---- trusts -------------------------------------------------------------------------

/** A trust's beneficiary tiers, and the columns that fill them. */
const TRUST_TIERS = [["income", "incomeBeneficiaries"], ["remainder", "remainderBeneficiaries"]] as const;
/** What a revocable living trust doesn't keep: it stores a name only. */
const NOT_REVOCABLE = ["grantor", "trustee", "grantorTrust", "crummey", "trustEnds", "incomeBeneficiaries", "remainderBeneficiaries"];

/** A revocable living trust (D7): its name only, matched on record by name. */
function revocableDraft(row: FFRow, ctx: PlaceContext, name: string | null): TargetDraft {
  const recordId = name === null ? null : ctx.book.records.revocable_trust.find((r) => sameText(r.values.name, name))?.id ?? null;
  const b = new DraftBuilder({ sectionId: "trusts", row, target: "revocable_trust", recordId, label: name ?? "Revocable living trust" })
    .put("name", name, ["trustName"]);
  const dropped = NOT_REVOCABLE.filter((columnId) => text(row, columnId) !== null);
  if (dropped.length > 0) {
    b.warn(`These aren't saved for a revocable living trust: ${quotedLabels("trusts", dropped)}.`);
  }
  return b.build();
}

export const TRUSTS_MAP: SectionMap = {
  sectionId: "trusts",
  placements: {
    // A revocable living trust → revocable_trust.name instead.
    trustName: { to: "entity.name" },
    trustType: { to: "entity.trustSubType" },
    grantor: { to: "entity.grantor" },
    trustee: { to: "entity.trustee" },
    grantorTrust: { to: "entity.isGrantor" },
    crummey: { to: "entity.crummeyPowers" },
    trustEnds: { to: "entity.trustEnds" },
    incomeBeneficiaries: { to: "trust_beneficiary_designation.beneficiaries" },
    remainderBeneficiaries: { to: "trust_beneficiary_designation.beneficiaries" },
  },
  place(rows, ctx) {
    return rows.flatMap((row) => {
      const name = text(row, "trustName");
      const type = valueFor(TRUST_TYPE_MAP, text(row, "trustType"));
      if (type === "revocable") return [revocableDraft(row, ctx, name)];
      const recordId = linkedRecordId(row, ctx, ["entity"]);
      const label = name ?? "Trust";
      const record = findRecord(ctx.book, "entity", recordId);
      const onRecord = record?.facts?.trustSubType;
      const typed = valueFor(TRUST_GRANTOR_MAP, text(row, "grantor"));
      // A charitable lead or remainder trust's remainder gift carries its grantor; only Details moves the two together.
      const grantorKept = (onRecord === "clt" || onRecord === "crt") && typed !== null && typed !== record?.values.grantor;
      const grantor = grantorKept ? null : typed;
      const b = new DraftBuilder({ sectionId: "trusts", row, target: "entity", recordId, label, fixed: { entityType: "trust", isIrrevocable: true } })
        .put("name", name, ["trustName"])
        .put("trustSubType", type, ["trustType"])
        // "Someone else" is "none", which the save writes as no grantor.
        .put("grantor", grantor, ["grantor"])
        .put("trustee", text(row, "trustee"), ["trustee"])
        .put("isGrantor", bool(row, "grantorTrust"), ["grantorTrust"])
        .put("crummeyPowers", bool(row, "crummey"), ["crummey"])
        .put("trustEnds", valueFor(TRUST_ENDS_MAP, text(row, "trustEnds")), ["trustEnds"]);
      if (grantorKept) b.warn("A charitable lead or remainder trust's grantor changes in Details — its remainder gift moves with it.");
      // A charitable lead or remainder trust needs terms the fact finder doesn't ask — unless it's already one on record.
      if ((type === "clt" || type === "crt") && onRecord !== type) {
        b.block("A charitable lead or remainder trust needs its split-interest terms — add it in Details.", "trustType");
      }
      needsCoClient(b, ctx, grantor, "grantor");
      const beneficiaries = beneficiariesOf(b, row, ctx, { target: "trust_beneficiary_designation", tiers: TRUST_TIERS, recordId, label });
      return beneficiaries ? [b.build(), beneficiaries] : [b.build()];
    });
  },
};

// ---- will provisions ---------------------------------------------------------------------

const isResiduary = (row: FFRow) => valueFor(BEQUEST_KIND_MAP, text(row, "gift")) === "residuary";

type Recipients = { ok: true; recipients: { who: RecordRef; percentage: number }[] } | { ok: false; reason: string };

/** "Emma 60%, Lucas 40%" → a provision's recipients (D6). A will can't give to its own maker; a debt goes only to family or trusts. */
function recipientsOf(names: string, ctx: PlaceContext, person: Person, debt: boolean): Recipients {
  const shares = sharesOf(names, ctx, ["household", "family", "external", "trust"]);
  if (!shares.ok) return shares;
  for (const { who, label } of shares.shares) {
    if (who.ref === "person" && who.role === person) return { ok: false, reason: `${label} can't receive from their own will.` };
    if (debt && (who.ref === "person" || who.target === "external_beneficiary")) {
      return { ok: false, reason: `A debt can be left only to family members or trusts — not to ${label}.` };
    }
  }
  return { ok: true, recipients: shares.shares.map((s) => ({ who: s.who, percentage: s.percent })) };
}

/** A specific asset or debt row, read: what it gives, the asset found, and its condition (a debt's is always "always"). */
interface Provision {
  row: FFRow;
  kind: string | null;
  debt: boolean;
  assetText: string | null;
  asset: RefResult | null;
  condition: string | null;
}

function provisionOf(row: FFRow, ctx: PlaceContext): Provision {
  const kind = valueFor(BEQUEST_KIND_MAP, text(row, "gift"));
  const debt = kind === "liability";
  const assetText = text(row, "asset");
  const asset = kind === null || assetText === null ? null : debt ? findLiability(ctx.refs, assetText) : findAccount(ctx.refs, assetText);
  return { row, kind, debt, assetText, asset, condition: valueFor(BEQUEST_COND_MAP, text(row, "condition")) };
}

/** Row id → its provision on record; row id → how many it could be (two or more left), and whether the row named a Condition. */
interface OnRecord {
  ids: Map<string, string>;
  ambiguous: Map<string, { count: number; conditioned: boolean }>;
}

/**
 * D8: each row's provision on record in this person's will — one giving the
 * same asset, each matched once. Every row's same-condition match first, across
 * all the rows, so an earlier row can't take the provision a later row names;
 * then the rest take what's left. A row with two or more left — blank
 * Condition or one that matched none — never guesses: it blocks.
 */
function provisionsOnRecord(provisions: readonly Provision[], ctx: PlaceContext, person: Person): OnRecord {
  const found: OnRecord = { ids: new Map(), ambiguous: new Map() };
  const taken = new Set<string>();
  const left = ({ asset }: Provision) => {
    if (!asset?.ok || asset.ref.ref !== "record") return [];
    const key = `${asset.ref.target === "liability" ? "liability" : "account"}:${asset.ref.id}`;
    return ctx.book.records.will_bequest.filter((r) => r.facts?.grantor === person && r.facts.assetKey === key && !taken.has(r.id));
  };
  const take = (p: Provision, id: string) => {
    taken.add(id);
    found.ids.set(p.row.id, id);
  };
  const wanted = (p: Provision) => (p.debt ? "always" : p.condition);
  for (const p of provisions) {
    const same = left(p).find((r) => r.values.condition === wanted(p));
    if (same) take(p, same.id);
  }
  for (const p of provisions) {
    if (found.ids.has(p.row.id)) continue;
    const rest = left(p);
    if (rest.length > 1) found.ambiguous.set(p.row.id, { count: rest.length, conditioned: wanted(p) !== null });
    else if (rest.length > 0) take(p, rest[0].id);
  }
  return found;
}

/**
 * A specific asset or a debt under the person's will. `fixed` carries the
 * provision's name (the asset's) and its place in the will — both required.
 * A blank % of it or condition defaults only on a new provision.
 */
function bequestDraft(
  provision: Provision, ctx: PlaceContext, person: Person, will: Will, sortOrder: number, seen: { onRecord: OnRecord; debts: Set<string> },
): TargetDraft {
  const { row, kind, debt, assetText, asset, condition } = provision;
  const recordId = seen.onRecord.ids.get(row.id) ?? null;
  const name = asset?.ok ? asset.label : (assetText ?? "Will provision");
  const b = new DraftBuilder({
    sectionId: "bequests", row, target: "will_bequest", recordId, label: `${will.label} — ${name}`, fixed: { name, sortOrder }, parent: will.ref,
  });
  if (kind === null) return b.block("Pick what this provision gives.", "gift").build();
  const ambiguous = seen.onRecord.ambiguous.get(row.id);
  if (ambiguous !== undefined) {
    const n = ambiguous.count === 2 ? "Two" : ambiguous.count;
    const reason = ambiguous.conditioned
      ? `${n} provisions on record give ${name}, ${ambiguous.count === 2 ? "neither" : "none"} with this Condition — pick one of theirs.`
      : `${n} provisions on record give ${name} — pick a Condition.`;
    return b.block(reason, "condition").build();
  }
  b.put("kind", kind, ["gift"], debt ? undefined : { assetMode: "specific" });
  if (asset === null) b.block(debt ? "Name the debt." : "Name the asset or account it gives.", "asset");
  else if (!asset.ok) b.block(asset.reason, "asset");
  else {
    b.put(debt ? "liabilityId" : "accountId", asset.ref, ["asset"]);
    // A will holds one provision per debt.
    const key = refKey(asset.ref);
    if (debt && seen.debts.has(key)) b.block(`This will already has a provision for "${asset.label}" — one per debt.`, "asset");
    if (debt) seen.debts.add(key);
  }
  const percent = num(row, "percent");
  // All of it only for a truly blank cell on a new provision: an unreadable one places nothing, so validation asks for it there.
  if (!debt) putOrDefault(b, "percentage", row, "percent", recordId === null ? 100 : null, ctx);
  else if (percent !== null && percent !== 100) b.warn(`"% of it" isn't saved for a debt — the recipients' shares say who pays what.`);
  const names = text(row, "recipients");
  const recipients = names === null ? null : recipientsOf(names, ctx, person, debt);
  if (recipients?.ok) b.put("recipients", recipients.recipients, ["recipients"]);
  else if (recipients) b.block(recipients.reason, "recipients");
  if (debt) {
    b.put("condition", "always", condition === "always" ? ["condition"] : []);
    if (condition !== null && condition !== "always") b.warn(`A debt provision always applies, so "Condition" isn't saved.`);
  } else {
    b.put("condition", condition ?? (recordId === null ? "always" : null), condition === null ? [] : ["condition"]);
  }
  if (will.recordId !== null) b.warn("Saving changes only the provisions listed here; the will's other provisions stay.");
  return b.build();
}

const UNREAD_SHARE = `"% of it" didn't read as a number — enter the percent, or clear it to leave all of it.`;

/**
 * Everyone who receives the rest of the person's estate (D7): all their
 * "Remaining estate" rows as one set, each row's "% of it" (blank = all of it)
 * scaling its shares. It replaces the set on record — the will's id (Task 14).
 */
function residuaryDraft(rows: readonly FFRow[], ctx: PlaceContext, person: Person, will: Will): TargetDraft | null {
  const b = new DraftBuilder({
    sectionId: "bequests", row: rows[0], target: "will_residuary_recipient", recordId: will.recordId, label: `${will.label} — remaining estate`, parent: will.ref,
  });
  const set: PlacedValue[] = [];
  const from: CellRef[] = [];
  for (const row of rows) {
    if (text(row, "asset") !== null) b.warn(`The remaining estate isn't one asset, so "Asset / account / debt" isn't saved.`);
    const condition = valueFor(BEQUEST_COND_MAP, text(row, "condition"));
    if (condition !== null && condition !== "always") b.warn(`The remaining estate has no condition, so "Condition" isn't saved.`);
    const names = text(row, "recipients");
    if (names === null) continue;
    const found = recipientsOf(names, ctx, person, false);
    if (!found.ok) return b.block(found.reason, cellOf("bequests", row, "recipients")).build();
    const share = num(row, "percent");
    // Blank is all of it; an unreadable % of it is never read as all of it.
    if (share === null && ctx.removed(row.id, "percent")) return b.block(UNREAD_SHARE, cellOf("bequests", row, "percent")).build();
    set.push(...found.recipients.map((r) => ({ who: r.who, percentage: share === null ? r.percentage : Math.round(r.percentage * share) / 100 })));
    if (share !== null) from.push(cellOf("bequests", row, "percent"));
    from.push(cellOf("bequests", row, "recipients"));
  }
  if (set.length === 0) return null;
  return b.put("recipients", set, from).build();
}

export const BEQUESTS_MAP: SectionMap = {
  sectionId: "bequests",
  placements: {
    willOf: { to: "will.grantor" },
    gift: { to: "will_bequest.kind" },
    // A debt → will_bequest.liabilityId.
    asset: { to: "will_bequest.accountId" },
    percent: { to: "will_bequest.percentage" },
    // Remaining estate → will_residuary_recipient.recipients.
    recipients: { to: "will_bequest.recipients" },
    condition: { to: "will_bequest.condition" },
  },
  place(rows, ctx) {
    const drafts: TargetDraft[] = [];
    for (const person of PEOPLE) {
      const mine = provisionsOf(rows, person);
      if (mine.length === 0) continue;
      const will = willOf(ctx, person);
      if (will.recordId === null) {
        const docs = docsRow(ctx, person);
        const checked = bool(docs, "will") === true ? [cellOf("estate_docs", docs, "will")] : [];
        drafts.push(newWill(ctx, person, will, [...checked, ...mine.map((r) => cellOf("bequests", r, "willOf"))]));
      }
      const provisions = mine.filter((r) => !isResiduary(r)).map((row) => provisionOf(row, ctx));
      const seen = { onRecord: provisionsOnRecord(provisions, ctx, person), debts: new Set<string>() };
      provisions.forEach((p, i) => drafts.push(bequestDraft(p, ctx, person, will, i, seen)));
      const rest = mine.filter(isResiduary);
      const residuary = rest.length > 0 ? residuaryDraft(rest, ctx, person, will) : null;
      if (residuary) drafts.push(residuary);
    }
    for (const row of rows) {
      if (valueFor(PERSON_MAP, text(row, "willOf")) !== null) continue;
      drafts.push(
        new DraftBuilder({
          sectionId: "bequests", row, target: isResiduary(row) ? "will_residuary_recipient" : "will_bequest", recordId: null,
          label: text(row, "asset") ?? "Will provision",
        }).block("Pick whose will this is.", "willOf").build(),
      );
    }
    return drafts;
  },
};

// ---- prior gifts, closing notes ------------------------------------------------------------

/** "Cash or asset given" and "709 filed?" have no field of their own: the gift's notes (spec § 8). */
function giftNotes(row: FFRow): { notes: string | null; columns: string[] } {
  const given = text(row, "given")?.replace(/[.\s]+$/, "");
  const filed = text(row, "form709Filed");
  const notes: string[] = [];
  const columns: string[] = [];
  if (given) {
    notes.push(`Given: ${given}.`);
    columns.push("given");
  }
  if (filed) {
    notes.push(`Form 709 filed: ${filed}.`);
    columns.push("form709Filed");
  }
  return { notes: notes.join(" ") || null, columns };
}

export const GIFTS_MAP: SectionMap = {
  sectionId: "gifts",
  placements: {
    year: { to: "gift.year" },
    from: { to: "gift.grantor" },
    recipient: { to: "gift.recipient" },
    given: { to: "gift.notes" },
    amount: { to: "gift.amount" },
    form709Filed: { to: "gift.notes" },
  },
  place(rows, ctx) {
    return rows.map((row) => {
      const year = num(row, "year");
      const recipient = text(row, "recipient");
      const grantor = valueFor(GIFT_FROM_MAP, text(row, "from"));
      // Every prior gift saves as cash of its Amount / value (D7): the asset itself is never moved.
      const b = new DraftBuilder({
        sectionId: "gifts", row, target: "gift", recordId: linkedRecordId(row, ctx, ["gift"]),
        label: `${year === null ? "Gift" : `${year} gift`}${recipient === null ? "" : ` to ${recipient}`}`,
      })
        .put("year", year, ["year"])
        .put("grantor", grantor, ["from"]);
      needsCoClient(b, ctx, grantor, "from");
      if (recipient !== null) {
        // findPerson refuses the client, the co-client and a revocable trust, saying why.
        const found = findPerson(ctx.refs, recipient, { allow: ["family", "external", "trust"] });
        const several = parseShares(recipient);
        if (found.ok) b.put("recipient", found.ref, ["recipient"]);
        else b.block(several.ok && several.parts.length > 1 ? "A gift has one recipient — list each gift on its own row." : found.reason, "recipient");
      }
      const { notes, columns } = giftNotes(row);
      return b.put("amount", num(row, "amount"), ["amount"]).put("notes", notes, columns).build();
    });
  },
};

/** "Anything else we should know?": free text for the AI step (the runner makes it a leftover). */
export const FINAL_NOTES_MAP: SectionMap = {
  sectionId: "final_notes",
  placements: { notes: { note: "general" } },
  place: () => [],
};
