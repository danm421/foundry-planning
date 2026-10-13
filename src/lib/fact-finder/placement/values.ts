// src/lib/fact-finder/placement/values.ts
/**
 * How the diff reads a placed value (D8): when it's empty, when two are the
 * same (kind-aware tolerances; people, shares and holdings as sets), and how
 * one prints on the change list. Pure and client-safe — the change list may
 * import it.
 */
import { formatMoney, livingItemLine } from "@/domain/forge/row-lines";
import { YEAR_REF_LABELS, type YearRef } from "@/lib/milestones";
import { isRecordRef, type PlacedValue, type RecordRef } from "../change-set";
import { labelFor, type OptionMap } from "../enums";
import { MONTHS } from "../schema";
import { holdingKey, stableStringify } from "../state";
import type { ValueKind } from "./targets";
import type { RecordBook } from "./types";

type Entry = { [key: string]: PlacedValue };

/** null, undefined, a blank string, [] or {}. */
export function isEmptyValue(value: PlacedValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

const MONEY = 0.005;
const RATE = 0.00005;
const PERCENT = 0.005;
const NUMBER = 1e-6;
const TOLERANCE: Partial<Record<ValueKind, number>> = {
  money: MONEY, rate: RATE, percent: PERCENT, number: NUMBER, integer: NUMBER, year: NUMBER, month: NUMBER,
};

/** Kind-aware equality; person refs compare equal to the household's family member records. */
export function sameValue(
  kind: ValueKind,
  a: PlacedValue | undefined,
  b: PlacedValue | undefined,
  people: RecordBook["people"],
): boolean {
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  const who = (e: Entry) => refKey(e.who, people);
  switch (kind) {
    case "money": case "rate": case "percent": case "number": case "integer": case "year": case "month":
      return close(a, b, TOLERANCE[kind] ?? 0);
    case "text":
      return words(a) === words(b);
    case "ref": case "personOrName": case "policyOwner":
      return refKey(a, people) === refKey(b, people);
    case "timing":
      return typeof a === "number" || typeof b === "number" ? close(a, b, 0) : stableStringify(a) === stableStringify(b);
    case "owners":
      return sameSet(a, b, who, (x, y) => close(x.percent, y.percent, RATE));
    case "recipients":
      return sameSet(a, b, who, (x, y) => close(x.percentage, y.percentage, PERCENT));
    case "beneficiaries":
      return sameSet(a, b, (e) => `${String(e.tier)}|${who(e)}`, (x, y) => close(x.percentage, y.percentage, PERCENT));
    case "items":
      return sameSet(a, b, (e) => `${words(e.name)}|${String(e.frequency)}`, (x, y) => close(x.amount, y.amount, MONEY));
    case "holdings":
      // A ticker's value on record moves with the nightly price, so only a position with no ticker compares its value.
      return sameSet(
        a, b,
        (e) => holdingKey({ ticker: str(e.ticker), name: str(e.name) }) ?? "",
        (x, y) => closeUnlessBlank(x.shares, y.shares, NUMBER)
          && (!isEmptyValue(x.ticker) || closeUnlessBlank(x.marketValue, y.marketValue, MONEY)),
      );
    case "tranches":
      return sameSet(a, b, (e) => String(e.vestDate), (x, y) => close(x.shares, y.shares, NUMBER));
    default:
      return stableStringify(a) === stableStringify(b);
  }
}

/** A number, or a numeric string as a stored decimal comes back. */
function num(value: PlacedValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function close(a: PlacedValue | undefined, b: PlacedValue | undefined, tolerance: number): boolean {
  const x = num(a);
  const y = num(b);
  return x !== null && y !== null && Math.abs(x - y) <= tolerance + 1e-9;
}

/** A blank on either side isn't a difference. */
function closeUnlessBlank(a: PlacedValue | undefined, b: PlacedValue | undefined, tolerance: number): boolean {
  return isEmptyValue(a) || isEmptyValue(b) || close(a, b, tolerance);
}

function str(value: PlacedValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function words(value: PlacedValue | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** A record's id names it; a person is the household's family member record when the book has one. */
function refKey(value: PlacedValue | undefined, people: RecordBook["people"]): string {
  if (!isRecordRef(value)) return typeof value === "string" ? `text:${words(value)}` : stableStringify(value ?? null);
  if (value.ref === "record") return `id:${value.id}`;
  if (value.ref === "line") return `line:${value.lineId}`;
  const id = people[value.role];
  return id ? `id:${id}` : `person:${value.role}`;
}

function entries(value: PlacedValue | undefined): Entry[] {
  return Array.isArray(value) ? (value.filter((v) => typeof v === "object" && v !== null && !Array.isArray(v)) as Entry[]) : [];
}

/** Same entries in any order: each one pairs with an unused entry of the same key that `same` accepts. */
function sameSet(
  a: PlacedValue | undefined,
  b: PlacedValue | undefined,
  keyOf: (e: Entry) => string,
  same: (x: Entry, y: Entry) => boolean,
): boolean {
  const xs = entries(a);
  const left = entries(b);
  if (xs.length !== left.length) return false;
  for (const x of xs) {
    const at = left.findIndex((y) => keyOf(y) === keyOf(x) && same(x, y));
    if (at < 0) return false;
    left.splice(at, 1);
  }
  return true;
}

export interface FormatContext {
  options?: OptionMap;
  labelOf(ref: RecordRef): string;
}

const EMPTY = "—";
const TIERS = [["primary", "Primary"], ["contingent", "Contingent"], ["income", "Income"], ["remainder", "Remainder"]] as const;

/** "$412,330", "6.5%", "Mar 2026", "Joint (50% / 50%)", "Emma 50%, Lucas 50%", "Mark Retirement", "—" for empty. */
export function formatValue(kind: ValueKind, value: PlacedValue | undefined, ctx: FormatContext): string {
  if (value === undefined || isEmptyValue(value)) return EMPTY;
  const n = num(value);
  switch (kind) {
    case "money":
      return formatMoney(value);
    case "rate":
      return n === null ? String(value) : percentText(n * 100, 3);
    case "percent":
      return n === null ? String(value) : percentText(n, 2);
    case "number":
      return n === null ? String(value) : n.toLocaleString("en-US", { maximumFractionDigits: 4 });
    case "month":
      return (n !== null && MONTHS[n - 1]) || String(value);
    case "date":
      return dateText(String(value), true);
    case "monthYear":
      return dateText(String(value), false);
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "choice":
      return labelFor(ctx.options ?? [], String(value)) ?? inWords(String(value));
    case "ref": case "personOrName":
      return whoText(value, ctx);
    case "policyOwner":
      return value === "joint" ? "Joint" : whoText(value, ctx);
    case "owners":
      return ownersText(entries(value), ctx);
    case "recipients":
      return sharesText(entries(value), ctx);
    case "beneficiaries":
      return beneficiariesText(entries(value), ctx);
    case "timing":
      return n !== null ? String(n) : yearRefText(value, ctx);
    case "items":
      return entries(value)
        .map((i) => livingItemLine({ name: String(i.name), amount: num(i.amount) ?? 0, frequency: String(i.frequency) }))
        .join(", ");
    case "holdings":
      return holdingsText(entries(value));
    case "tranches":
      return entries(value)
        .map((t) => `${dateText(String(t.vestDate), true)}: ${(num(t.shares) ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })} shares`)
        .join("; ");
    default:
      return String(value);
  }
}

/** 6.5 → "6.5%", at most `digits` decimals. */
function percentText(percent: number, digits: number): string {
  return `${Number(percent.toFixed(digits))}%`;
}

/** "2026-03-04" → "Mar 4, 2026"; "2026-03" (or without the day) → "Mar 2026". */
function dateText(value: string, withDay: boolean): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  const month = m ? MONTHS[Number(m[2]) - 1]?.slice(0, 3) : undefined;
  if (!m || !month) return value;
  return withDay && m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`;
}

/** An enum value an option map doesn't list (an income type of "social_security") → "Social security". */
function inWords(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function whoText(value: PlacedValue, ctx: FormatContext): string {
  return isRecordRef(value) ? ctx.labelOf(value) : typeof value === "string" ? value : EMPTY;
}

function roleOf(e: Entry): "client" | "spouse" | null {
  return isRecordRef(e.who) && e.who.ref === "person" ? e.who.role : null;
}

/** Owner shares are fractions: the client and co-client together print as Joint, one full owner as their name. */
function ownersText(owners: Entry[], ctx: FormatContext): string {
  const share = (e: Entry | undefined) => percentText((num(e?.percent ?? null) ?? 0) * 100, 2);
  const byRole = (role: "client" | "spouse") => owners.find((e) => roleOf(e) === role);
  if (owners.length === 2 && byRole("client") && byRole("spouse")) {
    return `Joint (${share(byRole("client"))} / ${share(byRole("spouse"))})`;
  }
  if (owners.length === 1 && close(owners[0].percent, 1, RATE)) return whoText(owners[0].who, ctx);
  return owners.map((e) => `${whoText(e.who, ctx)} ${share(e)}`).join(", ");
}

/** Designation and recipient shares are whole percents. */
function sharesText(list: Entry[], ctx: FormatContext): string {
  return list.map((e) => `${whoText(e.who, ctx)} ${percentText(num(e.percentage) ?? 0, 2)}`).join(", ");
}

function beneficiariesText(list: Entry[], ctx: FormatContext): string {
  if (list.every((e) => e.tier === "primary")) return sharesText(list, ctx);
  return TIERS.map(([tier, label]) => [label, list.filter((e) => e.tier === tier)] as const)
    .filter(([, tierList]) => tierList.length > 0)
    .map(([label, tierList]) => `${label}: ${sharesText(tierList, ctx)}`)
    .join(" · ");
}

/** As the Details year picker names a milestone: a retirement by the person's name. */
function yearRefText(value: PlacedValue, ctx: FormatContext): string {
  const yearRef = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Entry).yearRef : null;
  if (yearRef === "client_retirement") return `${ctx.labelOf({ ref: "person", role: "client" })} Retirement`;
  if (yearRef === "spouse_retirement") return `${ctx.labelOf({ ref: "person", role: "spouse" })} Retirement`;
  if (yearRef === "plan_start") return "First Year";
  if (yearRef === "plan_end") return "Last Year";
  return typeof yearRef === "string" ? (YEAR_REF_LABELS[yearRef as YearRef] ?? inWords(yearRef)) : String(value);
}

function holdingsText(holdings: Entry[]): string {
  const values = holdings.map((h) => num(h.marketValue)).filter((v): v is number => v !== null);
  const count = `${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`;
  return values.length > 0 ? `${count} · ${formatMoney(values.reduce((sum, v) => sum + v, 0))}` : count;
}
