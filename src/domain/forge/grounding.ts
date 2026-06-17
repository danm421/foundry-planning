// src/domain/forge/grounding.ts

// Matches $2.5M, $100,000, 92%, 2026, 0.92, etc. (M/K suffix case-insensitive)
const NUMBER_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:[MKmk])?%?/g;

/** Reduce a token to the set of plain numeric strings it could mean, so a
 *  payload that stores 2500000 grounds an answer that wrote "$2.5M". */
function candidateValues(token: string): string[] {
  const trimmed = token.trim();
  const hasPercent = trimmed.endsWith("%");
  const suffix = /([MKmk])%?$/.exec(trimmed)?.[1]?.toUpperCase();
  const numeric = trimmed.replace(/[$,%\sMKmk]/g, "");
  const base = Number(numeric);
  if (!Number.isFinite(base)) return [];

  const values = new Set<string>();
  const push = (n: number) => {
    values.add(String(n));
    // Integer form for whole numbers (2500000, not 2500000.0).
    if (Number.isInteger(n)) values.add(String(Math.round(n)));
  };

  if (hasPercent) {
    // A percent in prose maps ONLY to its decimal payload form (92% ↔ 0.92).
    // Do NOT push the bare integer — it could match an unrelated count/age/id.
    push(base / 100);
    values.add((base / 100).toFixed(2)); // e.g. "0.92"
  } else if (suffix === "M") {
    push(base * 1_000_000);
  } else if (suffix === "K") {
    push(base * 1_000);
  } else {
    push(base);
  }
  return [...values];
}

/** Normalize a payload haystack to a comparable digit string set. */
function payloadNumbers(payloads: string[]): Set<string> {
  const set = new Set<string>();
  const haystack = payloads.join(" ");
  for (const m of haystack.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    set.add(String(n));
    if (Number.isInteger(n)) set.add(String(Math.round(n)));
    set.add(raw); // keep the literal (e.g. "0.92")
  }
  return set;
}

/**
 * Return the list of numeric tokens in `answer` that do NOT trace to any value
 * present in `payloads`. An empty array means every figure is grounded.
 */
export function findUngroundedNumbers(answer: string, payloads: string[]): string[] {
  const known = payloadNumbers(payloads);
  const ungrounded: string[] = [];
  for (const m of answer.matchAll(NUMBER_TOKEN_RE)) {
    const token = m[0].trim();
    const candidates = candidateValues(token);
    if (candidates.length === 0) continue;
    const grounded = candidates.some((c) => known.has(c));
    if (!grounded) {
      // Report the token without the leading "$" for stable assertions.
      ungrounded.push(token.replace(/^\$/, ""));
    }
  }
  return ungrounded;
}
