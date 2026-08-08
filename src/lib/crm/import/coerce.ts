import { z } from "zod";
import {
  isUSPSStateCode,
  USPS_STATE_CODES,
  USPS_STATE_NAMES,
  type USPSStateCode,
} from "@/lib/usps-states";

/**
 * Per-cell coercion for the bulk import.
 *
 * PURE + CLIENT-SAFE. Every function here returns null (or a flag) instead of
 * throwing — a bad cell is a warning on one row, never a failure of the file.
 */

export type CrmHouseholdStatus = "prospect" | "active" | "inactive" | "archived";

const STATUSES: readonly CrmHouseholdStatus[] = ["prospect", "active", "inactive", "archived"];

// Excel stores dates as a day count. Serials from 61 up are days since
// 1899-12-30; 1..59 are days since 1899-12-31 (Excel believes 1900-02-29
// existed, which shifts everything after it by one). 60 IS that phantom day.
const EXCEL_EPOCH_AFTER_BUG = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_BEFORE_BUG = Date.UTC(1899, 11, 31);
const EXCEL_PHANTOM_LEAP_SERIAL = 60;
// Serial 2 is 1900-01-02. Serial 1 (1900-01-01) is deliberately excluded: a
// bare `1` in a date cell is far more likely to be junk (or a stray
// boolean/flag) than a genuine 1900-01-01 birthday.
const EXCEL_MIN_SERIAL = 2;
const EXCEL_MAX_SERIAL = 73415; // 2100-12-31
const MS_PER_DAY = 86_400_000;

function iso(y: number, m: number, d: number): string | null {
  // Round-trip through UTC to reject 2026-02-30 and friends.
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.trunc(serial);
  if (whole === EXCEL_PHANTOM_LEAP_SERIAL) return null;
  if (whole < EXCEL_MIN_SERIAL || whole > EXCEL_MAX_SERIAL) return null;
  const epoch = whole < EXCEL_PHANTOM_LEAP_SERIAL ? EXCEL_EPOCH_BEFORE_BUG : EXCEL_EPOCH_AFTER_BUG;
  return new Date(epoch + whole * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * ISO `YYYY-MM-DD`, US month-first `M/D/YYYY` (or `M-D-YYYY`), or an Excel
 * date serial. Two-digit years are refused rather than guessed. Returns null
 * for anything else — the caller turns that into a row warning.
 */
export function parseImportDate(raw: string | number): string | null {
  if (typeof raw === "number") return fromExcelSerial(raw);

  const s = raw.trim();
  if (!s) return null;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const usMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (usMatch) {
    return iso(Number(usMatch[3]), Number(usMatch[1]), Number(usMatch[2]));
  }

  // A bare number arriving as text is still an Excel serial.
  if (/^\d+(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s));

  return null;
}

/** Blank → prospect. Unknown → prospect, flagged so the caller can warn. */
export function parseStatus(raw: string): { value: CrmHouseholdStatus; recognized: boolean } {
  const s = raw.trim().toLowerCase();
  if (!s) return { value: "prospect", recognized: true };
  const hit = STATUSES.find((v) => v === s);
  return hit ? { value: hit, recognized: true } : { value: "prospect", recognized: false };
}

/** USPS 2-letter code or full state name → the code. Null when unreadable. */
export function parseState(raw: string): USPSStateCode | null {
  const s = raw.trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (isUSPSStateCode(upper)) return upper;
  const lower = s.toLowerCase();
  const byName = USPS_STATE_CODES.find(
    (code) => USPS_STATE_NAMES[code].toLowerCase() === lower,
  );
  return byName ?? null;
}

/** Lowercased address, or null when blank or malformed. */
export function parseEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // EXACTLY the validator createCrmContactSchema.email enforces, not a looser
  // approximation of it. The commit route validates the whole batch atomically
  // (`decisions: z.array(...).min(1)`), so an address this let through but Zod
  // rejected would 400 the ENTIRE import — not one row — with nothing on
  // screen pointing at the offending cell. Anything Zod refuses has to become
  // a per-row warning here instead. (z.email is browser-safe; this module
  // stays PURE + CLIENT-SAFE.)
  return z.email().safeParse(s).success ? s : null;
}

/** Trim to a column's max length, reporting whether anything was lost. */
export function clampText(raw: string, max: number): { value: string; truncated: boolean } {
  return raw.length <= max
    ? { value: raw, truncated: false }
    : { value: raw.slice(0, max), truncated: true };
}
