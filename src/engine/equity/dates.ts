/** ISO-date arithmetic for the equity engine. Strings in, strings out — the
 *  engine is pure and a `Date` object drags a timezone in with it. Every date
 *  here is a calendar date (`YYYY-MM-DD`), never an instant. */

const parse = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
};

const fmt = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Last day of a (1-based) month, so 29 Feb clamps instead of overflowing. */
const lastDay = (y: number, m: number): number =>
  [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export function yearOf(iso: string): number {
  return parse(iso)[0];
}

export function addYears(iso: string, n: number): string {
  const [y, m, d] = parse(iso);
  return fmt(y + n, m, Math.min(d, lastDay(y + n, m)));
}

/** Calendar-date comparison. ISO dates sort lexicographically, which is why
 *  the whole module can stay on strings. */
export function isStrictlyAfter(a: string, b: string): boolean {
  return a > b;
}

export function anniversaryIn(iso: string, year: number): string {
  const [, m, d] = parse(iso);
  return fmt(year, m, Math.min(d, lastDay(year, m)));
}

export function endOfYear(year: number): string {
  return `${year}-12-31`;
}
