// src/lib/fact-finder/placement/translate.ts
/**
 * Fact finder values → app values, read the same way by every section map.
 * Pure. Percents in the fact finder are whole numbers (6.5); the app stores
 * rates as fractions (0.065).
 */
import { MONTHS } from "../schema";

/** 6.5 → 0.065, without float noise (1.1 / 100 is 0.011000000000000001). */
export function toFraction(percent: number): number {
  return Number((percent / 100).toPrecision(12));
}

/** "March" → 3. Only the full month names the fact finder's options use. */
export function monthNumber(label: string): number | null {
  const i = (MONTHS as readonly string[]).indexOf(label);
  return i === -1 ? null : i + 1;
}

/** "2026-03", or a full ISO date "2026-03-15", → { month: 3, year: 2026 }. */
export function monthYearParts(value: string): { month: number; year: number } | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { month, year: Number(m[1]) } : null;
}

export function yesNo(label: string): boolean | null {
  return label === "Yes" ? true : label === "No" ? false : null;
}

export function termMonthsFromYears(years: number): number {
  return Math.round(years * 12);
}

/** Whole months from `from` to `to` (month-years or ISO dates; days ignored). Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number | null {
  const a = monthYearParts(from);
  const b = monthYearParts(to);
  if (!a || !b) return null;
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** "Jane Q. Smith" → { firstName: "Jane Q.", lastName: "Smith" }. One word → null. */
export function splitPersonName(full: string): { firstName: string; lastName: string } | null {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** One name and its share, as a whole percent (50 = 50%). */
export interface SharePart {
  name: string;
  percent: number;
}

const EVENLY = /\b(?:in\s+)?equal\s+shares?\b|\bequally\b|\bevenly\b/gi;
const SEPARATORS = /[,;/&\n]|\s+and\s+/i;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/;
const EDGE_PUNCTUATION = /^[\s.,;:=\-–—]+|[\s.,;:=\-–—]+$/g;

/**
 * "Emma 60%, Lucas 40%" or "Emma and Lucas equally" → names with whole
 * percents. Every name has a share (they must total 100) or none does (an even
 * split; the last name takes the rounding). "equally", "in equal shares" and
 * "evenly" are dropped from the names.
 */
export function parseShares(text: string): { ok: true; parts: SharePart[] } | { ok: false; reason: string } {
  const pieces = text
    .replace(EVENLY, " ")
    .split(SEPARATORS)
    .map((piece) => piece.trim())
    .filter(Boolean);
  if (pieces.length === 0) return { ok: false, reason: "No names given." };

  const read = pieces.map((piece) => {
    const m = PERCENT.exec(piece);
    return {
      name: piece.replace(PERCENT, " ").replace(EDGE_PUNCTUATION, "").replace(/\s+/g, " "),
      percent: m ? Number(m[1]) : null,
    };
  });
  if (read.some((part) => part.name === "")) {
    return { ok: false, reason: 'Each share needs a name, like "Emma 50%".' };
  }

  const withShare = read.filter((part) => part.percent !== null).length;
  if (withShare === 0) {
    const hundredths = Math.floor(10000 / read.length);
    return {
      ok: true,
      parts: read.map(({ name }, i) => ({
        name,
        percent: (i === read.length - 1 ? 10000 - hundredths * (read.length - 1) : hundredths) / 100,
      })),
    };
  }
  if (withShare < read.length) return { ok: false, reason: "Give every name a share, or none." };

  const parts = read.map(({ name, percent }) => ({ name, percent: percent as number }));
  const total = parts.reduce((sum, part) => sum + part.percent, 0);
  // In whole hundredths: in floats 100 − (33.33 × 3) is 0.010000000000005, just over a hundredth.
  if (Math.abs(Math.round(total * 100) - 10000) > 1) {
    return { ok: false, reason: `Shares add up to ${Number(total.toFixed(2))}%, not 100%.` };
  }
  return { ok: true, parts };
}
