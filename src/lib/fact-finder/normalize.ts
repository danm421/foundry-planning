// src/lib/fact-finder/normalize.ts
import { MONTHS, type FFColumn } from "./schema";
import type { FFCellValue } from "./types";

export type NormalizeResult =
  | { ok: true; value: FFCellValue }
  | { ok: false; issue: "unparsed" | "notAnOption"; text: string };

const EMPTY: NormalizeResult = { ok: true, value: null };

/**
 * One raw value (PDF text, model output, a typed edit) into the column's
 * canonical form. A value that won't parse comes back `ok: false` with its
 * text, so a reader can keep it flagged instead of dropping it.
 */
export function normalizeCell(column: FFColumn, raw: unknown): NormalizeResult {
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw === "string" && raw.trim() === "") return EMPTY;
  const text = typeof raw === "string" ? raw.trim() : String(raw);
  const value = (v: FFCellValue): NormalizeResult => ({ ok: true, value: v });
  const unparsed: NormalizeResult = { ok: false, issue: "unparsed", text };

  switch (column.kind) {
    case "text":
    case "notes":
      return value(text);
    case "money": {
      const n = typeof raw === "number" ? finite(raw) : parseMoney(text);
      return n === null ? unparsed : value(Math.round(n * 100) / 100);
    }
    case "number": {
      const n = typeof raw === "number" ? finite(raw) : parseNumber(text);
      return n === null ? unparsed : value(n);
    }
    case "percent": {
      const n = typeof raw === "number" ? finite(raw) : parsePercent(text);
      return n === null ? unparsed : value(n);
    }
    case "integer": {
      const n = typeof raw === "number" ? finite(raw) : parseNumber(text);
      return n !== null && Number.isInteger(n) ? value(n) : unparsed;
    }
    case "year": {
      const y = parseYear(raw);
      return y === null ? unparsed : value(y);
    }
    case "date": {
      const d = parseDate(text);
      return d === null ? unparsed : value(d);
    }
    case "monthYear": {
      const m = parseMonthYear(text);
      return m === null ? unparsed : value(m);
    }
    case "choice": {
      const option = matchOption(text, column.options ?? []);
      return option === null ? { ok: false, issue: "notAnOption", text } : value(option);
    }
    case "check": {
      const b = typeof raw === "boolean" ? raw : parseCheck(text);
      if (b === undefined) return unparsed;
      return b === null ? EMPTY : value(b);
    }
  }
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

const MONEY_SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, mn: 1e6, b: 1e9, bn: 1e9 };

/** "$1,234.56", "1.2M", "250k", "(1,234)" → number. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/\bUSD\b/gi, "").replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^\$/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/,/g, "");
  const m = /^(\d*\.?\d+)([a-z]{1,2})?$/i.exec(s);
  if (!m) return null;
  const suffix = m[2]?.toLowerCase();
  const mult = suffix === undefined ? 1 : MONEY_SUFFIX[suffix];
  if (mult === undefined) return null;
  const n = Number(m[1]) * mult;
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function parseNumber(raw: string): number | null {
  const s = raw.replace(/,/g, "").replace(/\s+/g, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

/** "6.5%" or "6.5" → 6.5. Never converts a fraction — 0.065 stays 0.065. */
export function parsePercent(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "");
  return parseNumber(s.endsWith("%") ? s.slice(0, -1) : s);
}

export function parseYear(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : /^\d{4}$/.test(String(raw).trim()) ? Number(String(raw).trim()) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2200 ? n : null;
}

const MONTH_INDEX: Record<string, number> = { sept: 9 };
MONTHS.forEach((m, i) => {
  MONTH_INDEX[m.toLowerCase()] = i + 1;
  MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i + 1;
});

function monthFromName(s: string): number | null {
  return MONTH_INDEX[s.toLowerCase().replace(/\.$/, "")] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function isoMonth(y: number, m: number): string | null {
  return m >= 1 && m <= 12 && y >= 1900 && y <= 2200 ? `${y}-${pad(m)}` : null;
}

/** "62" → 1962 and "27" → 2027: a two-digit year more than ten years out is last century. */
export function expandTwoDigitYear(yy: number, now: Date = new Date(), horizonYears = 10): number {
  const full = 2000 + yy;
  return full > now.getUTCFullYear() + horizonYears ? full - 100 : full;
}

/** Month/year columns include loan maturities, so they look further ahead than dates do (a 30-year "Matures 8/51" is 2051). */
const MONTH_YEAR_HORIZON_YEARS = 35;

/** ISO, M/D/YYYY, M/D/YY, "Aug 1, 2041", "1 Aug 2041" → yyyy-mm-dd. US month-first order. */
export function parseDate(raw: string, now: Date = new Date()): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? expandTwoDigitYear(Number(m[3]), now) : Number(m[3]);
    return isoDate(y, Number(m[1]), Number(m[2]));
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[1]);
    return month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[2]);
    return month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/** "2027-08", "08/2027", "8/27", "Aug 2027", or a full date → yyyy-mm. */
export function parseMonthYear(raw: string, now: Date = new Date()): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return isoMonth(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return isoMonth(Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[/.-](\d{2})$/.exec(s);
  if (m) return isoMonth(expandTwoDigitYear(Number(m[2]), now, MONTH_YEAR_HORIZON_YEARS), Number(m[1]));
  m = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[1]);
    return month ? isoMonth(Number(m[2]), month) : null;
  }
  const date = parseDate(s, now);
  return date ? date.slice(0, 7) : null;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Common ways documents print an option. Applied only when the target label is in the column's list. */
const SYNONYMS: Record<string, string> = {
  spouse: "Co-client",
  self: "Client",
  primary: "Client",
  y: "Yes",
  n: "No",
  true: "Yes",
  false: "No",
  mfj: "Married filing jointly",
  marriedjoint: "Married filing jointly",
  marriedjointly: "Married filing jointly",
  mfs: "Married filing separately",
  marriedseparate: "Married filing separately",
  marriedseparately: "Married filing separately",
  hoh: "Head of household",
  ira: "Traditional IRA",
  rolloverira: "Traditional IRA",
  rollover: "Traditional IRA",
  healthsavingsaccount: "HSA",
  certificateofdeposit: "CD",
  moneymarketfund: "Money market",
  moneymarketaccount: "Money market",
  mmf: "Money market",
  annual: "Annually",
  yearly: "Annually",
  peryear: "Annually",
  month: "Monthly",
  permonth: "Monthly",
  jointtenants: "JTWROS",
  jointtenantswithrightofsurvivorship: "JTWROS",
  nq: "Non-qualified",
  fia: "Fixed indexed",
  glwb: "Income rider (GLWB)",
  homeequity: "HELOC",
  homeequitylineofcredit: "HELOC",
  person: "Individual",
  son: "Child",
  daughter: "Child",
  stepson: "Stepchild",
  stepdaughter: "Stepchild",
  grandson: "Grandchild",
  granddaughter: "Grandchild",
  mother: "Parent",
  father: "Parent",
  brother: "Sibling",
  sister: "Sibling",
  nephew: "Niece/Nephew",
  uncle: "Aunt/Uncle",
  soninlaw: "Son/Daughter-in-law",
  daughterinlaw: "Son/Daughter-in-law",
  reimbursement: "Actual costs (reimbursement)",
  indemnity: "Full limit (indemnity)",
  fra: "At full retirement age",
  fullretirementage: "At full retirement age",
  livingtrust: "Revocable living trust",
  rlt: "Revocable living trust",
  rsus: "RSU",
  restrictedstockunit: "RSU",
  restrictedstockunits: "RSU",
  nso: "NQSO",
  nsos: "NQSO",
  nonqualified: "NQSO",
  nonqualifiedstockoption: "NQSO",
  nonqualifiedstockoptions: "NQSO",
  incentivestockoption: "ISO",
  incentivestockoptions: "ISO",
  isos: "ISO",
};

const STATE_CODES_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", districtofcolumbia: "DC", washingtondc: "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  newhampshire: "NH", newjersey: "NJ", newmexico: "NM", newyork: "NY", northcarolina: "NC",
  northdakota: "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", rhodeisland: "RI",
  southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", westvirginia: "WV", wisconsin: "WI", wyoming: "WY",
};

/**
 * One of `options`, or null. Tries, in order: exact, same letters and digits
 * ("401k" = "401(k)"), a known synonym, a month or state name, then a unique
 * prefix of at least three letters ("roth" → "Roth IRA").
 */
export function matchOption(raw: string, options: readonly string[]): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (options.includes(t)) return t;
  const k = key(t);
  if (!k) return null;
  const sameKey = options.find((o) => key(o) === k);
  if (sameKey) return sameKey;
  const synonym = SYNONYMS[k];
  if (synonym && options.includes(synonym)) return synonym;
  if (options.includes("January")) {
    const month = /^\d{1,2}$/.test(t) ? Number(t) : monthFromName(t);
    if (month && month >= 1 && month <= 12) return MONTHS[month - 1];
  }
  if (options.includes("WY")) {
    const code = STATE_CODES_BY_NAME[k];
    if (code && options.includes(code)) return code;
  }
  if (k.length >= 3) {
    const prefixed = options.filter((o) => key(o).startsWith(k));
    if (prefixed.length === 1) return prefixed[0];
  }
  return null;
}

const TRUE_TOKENS = new Set(["true", "yes", "y", "x", "checked", "on", "1", "✓", "✔"]);
const FALSE_TOKENS = new Set(["false", "no", "n", "unchecked", "0"]);

/** true / false; null for the PDF's unchecked "Off" (blank); undefined when unreadable. */
export function parseCheck(raw: string): boolean | null | undefined {
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "off") return null;
  if (TRUE_TOKENS.has(t)) return true;
  if (FALSE_TOKENS.has(t)) return false;
  return undefined;
}
