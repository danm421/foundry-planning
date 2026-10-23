// Pure and client-safe: shared by the compute-cache hashes and the scenario diff helpers.

/** Round to 6 decimals so float representation noise can't cause spurious misses. */
function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n;
}

/** Deterministic serialization: sorted keys + rounded numbers. */
function canonicalize(value: unknown): unknown {
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

/** Deterministic JSON: sorted keys, numbers rounded to 6 decimals. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
