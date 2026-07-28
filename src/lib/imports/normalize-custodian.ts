/**
 * Trailing-only legal/entity suffixes. Order matters: longer forms first so
 * "n a" is not stripped before "bank n a" has been considered as a whole.
 *
 * These are stripped ONLY from the end of the string. Removing them anywhere
 * would mangle real names — "Bank of America" would become "of america".
 */
const TRAILING_SUFFIXES = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "llc",
  "l l c",
  "inc",
  "llp",
  "lp",
  "plc",
  "corp",
  "co",
  "n a",
  "na",
  "fsb",
  "ltd",
];

/**
 * Normalize a custodian/institution name for comparison. Lowercases, drops
 * punctuation, collapses whitespace, then repeatedly strips trailing legal
 * suffixes. Returns null when nothing meaningful survives.
 */
export function normalizeCustodian(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip repeatedly: "Fidelity Brokerage Services LLC Inc." -> "fidelity brokerage services"
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of TRAILING_SUFFIXES) {
      if (s === suffix) return null;
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }

  return s || null;
}

/**
 * Compare two ALREADY-normalized custodian names. True when they are equal or
 * when one is a whole-word prefix of the other, so "fidelity" matches
 * "fidelity investments" but "fid" does not match "fidelity".
 */
export function custodianMatches(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b} `) || b.startsWith(`${a} `);
}
