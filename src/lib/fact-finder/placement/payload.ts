// src/lib/fact-finder/placement/payload.ts
/**
 * A change line as the Details write path's request body (D9). Field keys are
 * the Details payload keys already; the fact finder's composites
 * (FACT_FINDER_ONLY) expand into theirs, refs become ids through `resolve`,
 * and people lists become each route's row shape. A set (designations, will
 * recipients) travels under its own key. Plan 4 calls this with real ids;
 * validate.ts with placeholders. Pure.
 */
import { isRecordRef, type ChangeLine, type PlacedValue, type RecordRef, type TargetKind } from "../change-set";
import { FACT_FINDER_ONLY, targetField } from "./targets";
import { monthYearParts } from "./translate";

export interface Resolve {
  /** An existing record's id, the id a Create line's record gets, or — for a person ref — the household family member's id. */
  id(ref: RecordRef): string;
  /** The year a milestone ("plan_start", "client_retirement"…) falls in. */
  year(yearRef: string): number;
}

type Body = Record<string, unknown>;
type Entry = { [key: string]: PlacedValue };

/** A line's values (its fixed values + ticked fields + their `with`) as the Details write path's request body. */
export function payloadFor(target: TargetKind, values: Record<string, PlacedValue>, resolve: Resolve): Body {
  const body: Body = {};
  for (const [key, value] of Object.entries(values)) {
    Object.assign(body, expand(target, key, value, resolve));
  }
  return body;
}

/**
 * fixed (Create lines only — D1) + each ticked field (and its `with`) of a line, as payloadFor's input. A field
 * the ticks don't list — or every field, with no ticks — keeps its default tick, so an unticked name never writes.
 */
export function lineValues(line: ChangeLine, ticks?: Record<string, boolean>): Record<string, PlacedValue> {
  const values: Record<string, PlacedValue> = line.action === "create" ? { ...line.fixed } : {};
  for (const field of line.fields) {
    if (!(ticks?.[field.key] ?? field.ticked)) continue;
    Object.assign(values, field.with, { [field.key]: field.next });
  }
  return values;
}

function expand(target: TargetKind, key: string, value: PlacedValue, resolve: Resolve): Body {
  const field = targetField(target, key);
  // fixed / with values are raw Details keys; a ref among them (a business income's ownerAccountId) is an id.
  if (!field) return { [key]: isRecordRef(value) ? resolve.id(value) : value };
  // employer, holdings: Plan 4 writes them through their own writers.
  if (FACT_FINDER_ONLY[`${target}.${key}`]?.expandsTo.length === 0) return {};
  if (target === "gift" && key === "recipient") return giftRecipient(value as RecordRef, resolve);
  // TRUST_GRANTOR_MAP's "Someone else": entities.grantor is client | spouse | null.
  if (target === "entity" && key === "grantor" && value === "none") return { grantor: null };

  switch (field.kind) {
    case "monthYear": {
      const parts = monthYearParts(String(value));
      return { [`${key}Month`]: parts?.month, [`${key}Year`]: parts?.year };
    }
    case "timing":
      return typeof value === "number"
        ? { [`${key}Year`]: value, [`${key}YearRef`]: null }
        : { [`${key}Year`]: resolve.year(String((value as Entry).yearRef)), [`${key}YearRef`]: (value as Entry).yearRef };
    case "personOrName":
      return isRecordRef(value)
        ? { [`${key}FamilyMemberId`]: resolve.id(value), [`${key}Name`]: null }
        : { [`${key}FamilyMemberId`]: null, [`${key}Name`]: value };
    case "ref":
      // A null link clears it: a standalone LTC policy's `with` drops the rider's life policy.
      return { [key]: value === null ? null : resolve.id(value as RecordRef) };
    case "owners":
      return { [key]: entries(value).map((e) => owner(target, e, resolve)) };
    case "policyOwner":
      return { [key]: value === "joint" ? { kind: "joint" } : policyOwner(value as RecordRef, resolve) };
    case "beneficiaries":
      return { [key]: entries(value).map((e, i) => designation(e, i, resolve)) };
    case "recipients":
      return { [key]: entries(value).map((e, i) => willRecipient(e, i, resolve)) };
    case "items":
      return { [key]: entries(value).map((item, i) => ({ id: `item-${i + 1}`, ...item })) };
    default:
      return { [key]: value };
  }
}

function entries(value: PlacedValue): Entry[] {
  return Array.isArray(value) ? (value as Entry[]) : [];
}

/** The kind of record a ref names; a household person is their family member. */
function kindOf(who: RecordRef): TargetKind {
  return who.ref === "person" ? "family_member" : who.target;
}

/** accounts / business / liabilities: `{ kind, familyMemberId | entityId, percent }`; notes receivable: one id key, no kind. */
function owner(target: TargetKind, e: Entry, resolve: Resolve): Body {
  const who = e.who as RecordRef;
  const id = resolve.id(who);
  const kind = kindOf(who);
  if (target === "note_receivable") {
    const idKey = kind === "entity" ? "entityId" : kind === "external_beneficiary" ? "externalBeneficiaryId" : "familyMemberId";
    return { [idKey]: id, percent: e.percent };
  }
  return kind === "entity"
    ? { kind: "entity", entityId: id, percent: e.percent }
    : { kind: "family_member", familyMemberId: id, percent: e.percent };
}

function policyOwner(who: RecordRef, resolve: Resolve): Body {
  const kind = kindOf(who);
  return { kind: kind === "entity" ? "entity" : kind === "external_beneficiary" ? "external" : "family", id: resolve.id(who) };
}

/** A designation row. The client and co-client go by household role, as the beneficiary editors write them. */
function designation(e: Entry, sortOrder: number, resolve: Resolve): Body {
  const who = e.who as RecordRef;
  const kind = kindOf(who);
  const source =
    who.ref === "person" ? { householdRole: who.role }
    : kind === "entity" ? { entityIdRef: resolve.id(who) }
    : kind === "external_beneficiary" ? { externalBeneficiaryId: resolve.id(who) }
    : { familyMemberId: resolve.id(who) };
  return { tier: e.tier, percentage: e.percentage, ...source, sortOrder };
}

/** A will recipient. A will can name only the OTHER principal, whom the wills routes call "spouse" (no id). */
function willRecipient(e: Entry, sortOrder: number, resolve: Resolve): Body {
  const who = e.who as RecordRef;
  const kind = kindOf(who);
  const recipient =
    who.ref === "person" ? { recipientKind: "spouse", recipientId: null }
    : { recipientKind: kind === "entity" || kind === "external_beneficiary" ? kind : "family_member", recipientId: resolve.id(who) };
  return { ...recipient, percentage: e.percentage, sortOrder };
}

/** One recipient key set, the other two cleared — an Update that changes the kind of recipient must not leave the old one. */
function giftRecipient(who: RecordRef, resolve: Resolve): Body {
  const kind = kindOf(who);
  const id = resolve.id(who);
  return {
    recipientFamilyMemberId: kind === "entity" || kind === "external_beneficiary" ? null : id,
    recipientEntityId: kind === "entity" ? id : null,
    recipientExternalBeneficiaryId: kind === "external_beneficiary" ? id : null,
  };
}
