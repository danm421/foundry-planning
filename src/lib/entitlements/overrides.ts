/** A raw override row as loaded from either override table (mode is DB `text`). */
export type OverrideRow = {
  entitlement: string;
  mode: string;
  reason: string;
  setBy: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/** The latest active override for an entitlement, with attribution for the UI. */
export type ActiveOverride = {
  entitlement: string;
  mode: "grant" | "revoke";
  reason: string;
  setBy: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * Pure: keep only active rows (no expiry or future expiry), then the latest row
 * per entitlement by createdAt. `now` is a parameter so this is unit-testable.
 * Result is sorted by entitlement key for stable rendering.
 *
 * Shared by both override tables — the firm-wide one and the per-user one,
 * which carry the same six columns.
 */
export function collapseActiveOverrides(rows: OverrideRow[], now: Date): ActiveOverride[] {
  const latest = new Map<string, OverrideRow>();
  for (const r of rows) {
    if (r.expiresAt !== null && r.expiresAt <= now) continue; // expired
    if (r.mode !== "grant" && r.mode !== "revoke") continue; // defensive
    const prev = latest.get(r.entitlement);
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.entitlement, r);
  }
  return Array.from(latest.values())
    .map((r) => ({
      entitlement: r.entitlement,
      mode: r.mode as "grant" | "revoke",
      reason: r.reason,
      setBy: r.setBy,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => a.entitlement.localeCompare(b.entitlement));
}
