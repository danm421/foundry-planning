import type { ProjectionYear, MedicareYearDetail } from "@/engine/types";

// ── Formatting (single source; page-pdf + chart import these) ────────────────
export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface MedicareYearBar {
  year: number;
  base: number;   // household base premiums (Part B std + Part D plan + Medigap), both spouses
  irmaa: number;  // household IRMAA surcharge (Part B + Part D), both spouses
  total: number;  // = household totalAnnualCost
  tier: number;   // representative tier = max(client, spouse) among enrolled members
}
export interface MedicareComposition {
  partB: number;
  partD: number;
  medigap: number;
  irmaa: number;
  total: number;
}
export interface TierLadderRow {
  tier: number;
  thresholdLabel: string | null;
  years: number;
}
export interface MedicareKpis {
  lifetimeMedicareCost: number;
  lifetimeIrmaa: number;
  irmaaShare: number;
  irmaaYears: number;
  enrolledYears: number;
  peakTier: number;
  peakTierYear: number | null;
}
export interface EnrollNote { year: number; age: number; }

// ── Helpers ──────────────────────────────────────────────────────────────────
function enrolledMembers(y: ProjectionYear): MedicareYearDetail[] {
  const m = y.medicare;
  if (!m) return [];
  const out: MedicareYearDetail[] = [];
  if (m.client?.enrolled) out.push(m.client);
  if (m.spouse?.enrolled) out.push(m.spouse);
  return out;
}

function representativeTier(y: ProjectionYear): number {
  const tiers = enrolledMembers(y).map((d) => d.irmaaTier);
  return tiers.length ? Math.max(...tiers) : 0;
}

// ── Per-year bars ────────────────────────────────────────────────────────────
export function buildMedicareBars(years: ProjectionYear[]): MedicareYearBar[] {
  const bars: MedicareYearBar[] = [];
  for (const y of years) {
    // The engine emits a `medicare` block for pre-enrollment years too (members
    // with `enrolled: false` and zero premiums), so gate on actual enrollment —
    // not the mere presence of the block — or the horizon starts decades early.
    if (enrolledMembers(y).length === 0) continue;
    const total = y.medicare!.totalAnnualCost;
    const irmaa = y.medicare!.totalIrmaaSurcharge;
    bars.push({ year: y.year, base: Math.max(0, total - irmaa), irmaa, total, tier: representativeTier(y) });
  }
  return bars;
}

// ── Lifetime composition ─────────────────────────────────────────────────────
export function computeComposition(years: ProjectionYear[]): MedicareComposition {
  let partB = 0, partD = 0, medigap = 0, irmaa = 0;
  for (const y of years) {
    for (const d of enrolledMembers(y)) {
      partB += d.partBStandardPremium;
      partD += d.partDPremium - d.partDIrmaaSurcharge;
      medigap += d.medigapPremium;
      irmaa += d.partBIrmaaSurcharge + d.partDIrmaaSurcharge;
    }
  }
  return { partB, partD, medigap, irmaa, total: partB + partD + medigap + irmaa };
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export function computeKpis(bars: MedicareYearBar[]): MedicareKpis {
  let lifetimeMedicareCost = 0, lifetimeIrmaa = 0, irmaaYears = 0, peakTier = 0;
  let peakTierYear: number | null = null;
  for (const b of bars) {
    lifetimeMedicareCost += b.total;
    lifetimeIrmaa += b.irmaa;
    if (b.irmaa > 0) irmaaYears++;
    if (b.tier > peakTier) { peakTier = b.tier; peakTierYear = b.year; }
  }
  const irmaaShare = lifetimeMedicareCost > 0 ? lifetimeIrmaa / lifetimeMedicareCost : 0;
  return { lifetimeMedicareCost, lifetimeIrmaa, irmaaShare, irmaaYears, enrolledYears: bars.length, peakTier, peakTierYear };
}

// ── Tier ladder ──────────────────────────────────────────────────────────────
// Derive each tier's entry threshold the way the in-app MagiTierChart does:
// a member in tier T with finite headroom implies tier (T+1) starts at
// sourceMagi + headroom.
function deriveTierEntryThresholds(years: ProjectionYear[]): Map<number, number> {
  const entry = new Map<number, number>();
  for (const y of years) {
    for (const d of enrolledMembers(y)) {
      if (Number.isFinite(d.headroomToNextTier)) {
        entry.set(d.irmaaTier + 1, Math.round(d.sourceMagi + d.headroomToNextTier));
      }
    }
  }
  return entry;
}

export function buildTierLadder(years: ProjectionYear[]): TierLadderRow[] {
  const counts = new Map<number, number>();
  let maxTier = 0;
  for (const y of years) {
    // Only count years with an actually-enrolled member (see buildMedicareBars);
    // otherwise pre-enrollment years register as spurious Tier 0 exposure.
    if (enrolledMembers(y).length === 0) continue;
    const t = representativeTier(y);
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (t > maxTier) maxTier = t;
  }
  const entries = deriveTierEntryThresholds(years);
  const rows: TierLadderRow[] = [];
  for (let tier = 0; tier <= maxTier; tier++) {
    const entry = entries.get(tier);
    const thresholdLabel = tier === 0 ? "Standard premium" : entry != null ? `≥ ${fmtUsd(entry)}` : null;
    rows.push({ tier, thresholdLabel, years: counts.get(tier) ?? 0 });
  }
  return rows;
}

// ── Near-term headroom (first cliff) ─────────────────────────────────────────
export function findNearTermHeadroom(
  years: ProjectionYear[],
): { year: number; amount: number; nextTier: number } | null {
  for (const y of years) {
    if (!y.medicare) continue;
    const d = y.medicare.client ?? y.medicare.spouse;
    if (!d?.enrolled) continue;
    if (Number.isFinite(d.headroomToNextTier) && d.headroomToNextTier > 0) {
      return { year: y.year, amount: Math.round(d.headroomToNextTier), nextTier: d.irmaaTier + 1 };
    }
  }
  return null;
}

// ── Enrollment note ──────────────────────────────────────────────────────────
export function findEnrollment(years: ProjectionYear[], owner: "client" | "spouse"): EnrollNote | null {
  for (const y of years) {
    const d = y.medicare?.[owner];
    if (d?.enrolled) return { year: y.year, age: d.age };
  }
  return null;
}
