// src/domain/forge/grounding.ts

// Matches $2.5M, $100,000, 92%, 2026, 0.92, etc. (M/K suffix case-insensitive)
// One shared source string so the boolean helper and the token scanner agree.
const NUMBER_TOKEN_SRC = String.raw`\$?\d[\d,]*(?:\.\d+)?\s?(?:[MKmk])?%?`;
const NUMBER_TOKEN_RE = new RegExp(NUMBER_TOKEN_SRC, "g");

/** True if `text` contains at least one numeric token. Used to decide whether a
 *  final answer needs the verification pass. A FRESH regex avoids the shared
 *  `lastIndex` state of the global `NUMBER_TOKEN_RE`. */
export function containsNumber(text: string): boolean {
  return new RegExp(NUMBER_TOKEN_SRC).test(text);
}

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

/** All payload numbers as raw floats (for magnitude/precision-tolerant matching). */
function payloadFloats(payloads: string[]): number[] {
  const out: number[] = [];
  for (const m of payloads.join(" ").matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** True if `token` matches a payload value once both are rounded to the token's
 *  DISPLAYED precision (the same display rules the prompt enforces): percentages
 *  to whole/one-decimal, M/K magnitudes to one decimal. Plain numbers are left to
 *  exact-candidate matching (return false here).
 *
 *  Magnitude rounding-tolerance applies ONLY at-or-above the suffix's own scale
 *  (≥ $1.0M for "M", ≥ $1K for "K"). A sub-scale token (e.g. "$0.1M") is NOT
 *  matched by this branch — otherwise an unrelated sub-million field (~$100k → 0.1
 *  after /1e6) would falsely ground a fabricated "$0.xM" figure. Sub-scale tokens
 *  fall back to exact-candidate matching. */
function groundedByRounding(token: string, floats: number[]): boolean {
  const t = token.trim();
  const isPct = t.endsWith("%");
  const suffix = /([MKmk])%?$/.exec(t)?.[1]?.toUpperCase();
  const base = Number(t.replace(/[$,%\sMKmk]/g, ""));
  if (!Number.isFinite(base)) return false;
  if (isPct) {
    return floats.some(
      (v) => Math.round(v * 100) === Math.round(base) || Math.abs(v * 100 - base) <= 0.05,
    );
  }
  if (suffix === "M") {
    return base >= 1 && floats.some((v) => Math.round((v / 1e6) * 10) / 10 === base);
  }
  if (suffix === "K") {
    return (
      base >= 1 &&
      floats.some(
        (v) => Math.round((v / 1e3) * 10) / 10 === base || Math.round(v / 1e3) === Math.round(base),
      )
    );
  }
  return false;
}

/**
 * Return the list of numeric tokens in `answer` that do NOT trace to any value
 * present in `payloads`. An empty array means every figure is grounded.
 */
export function findUngroundedNumbers(answer: string, payloads: string[]): string[] {
  const known = payloadNumbers(payloads);
  const floats = payloadFloats(payloads);
  const ungrounded: string[] = [];
  for (const m of answer.matchAll(NUMBER_TOKEN_RE)) {
    const token = m[0].trim();
    const candidates = candidateValues(token);
    if (candidates.length === 0) continue;
    const grounded = candidates.some((c) => known.has(c)) || groundedByRounding(token, floats);
    if (!grounded) {
      // Report the token without the leading "$" for stable assertions.
      ungrounded.push(token.replace(/^\$/, ""));
    }
  }
  return ungrounded;
}
