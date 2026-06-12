import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear } from "@/engine/types";
import { rmdEraTierWarning } from "@/lib/medicare/detectors/rmd-era-tier-warning";
import { survivorTierShock } from "@/lib/medicare/detectors/survivor-tier-shock";
import type { MedicareSummaryOptions } from "./options-schema";
import {
  buildMedicareBars,
  computeComposition,
  computeKpis,
  buildTierLadder,
  findNearTermHeadroom,
  findEnrollment,
  type MedicareYearBar,
  type MedicareComposition,
  type TierLadderRow,
  type MedicareKpis,
  type EnrollNote,
} from "./aggregate";
import { buildMedicareNarrative } from "./narrative";

export interface MedicareSummaryPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  kpis: MedicareKpis;
  bars: MedicareYearBar[];
  composition: MedicareComposition;
  tierLadder: TierLadderRow[];
  headroom: { year: number; amount: number; nextTier: number } | null;
  enrollment: { client: EnrollNote | null; spouse: EnrollNote | null };
  narrative: string[];
}

// Mirrors the in-app MedicareCallouts wiring (rmdStartAges hardcoded to 73).
function detectorContext(ctx: BuildDataContext) {
  return {
    years: ctx.years,
    expenses: ctx.clientData.expenses.map((e) => ({
      id: e.id,
      name: e.name,
      annualAmount: e.annualAmount,
      startYear: e.startYear,
      endYear: e.endYear,
      endsAtMedicareEligibilityOwner: e.endsAtMedicareEligibilityOwner ?? null,
    })),
    medicareCoverage: ctx.clientData.medicareCoverage ?? [],
    rmdStartAges: { client: 73, spouse: 73 },
  };
}

function representativeTierAt(y: ProjectionYear | undefined): number {
  if (!y?.medicare) return 0;
  const tiers: number[] = [];
  if (y.medicare.client?.enrolled) tiers.push(y.medicare.client.irmaaTier);
  if (y.medicare.spouse?.enrolled) tiers.push(y.medicare.spouse.irmaaTier);
  return tiers.length ? Math.max(...tiers) : 0;
}

export function buildMedicareSummaryData(
  ctx: BuildDataContext,
  _options: MedicareSummaryOptions,
): MedicareSummaryPageData {
  const { years } = ctx;
  const bars = buildMedicareBars(years);
  const isEmpty = bars.length === 0;

  const kpis = computeKpis(bars);
  const composition = computeComposition(years);
  const tierLadder = buildTierLadder(years);
  const headroom = findNearTermHeadroom(years);
  const enrollment = {
    client: findEnrollment(years, "client"),
    spouse: ctx.spouseName ? findEnrollment(years, "spouse") : null,
  };

  // Detectors gate the narrative; structured numbers come from the projection.
  const dctx = detectorContext(ctx);

  const rmd = rmdEraTierWarning(dctx);
  const rmdEra =
    rmd && rmd.impactedYears.length
      ? {
          firstYear: rmd.impactedYears[0]!,
          lastYear: rmd.impactedYears[rmd.impactedYears.length - 1]!,
          total: rmd.totalSurchargeOverWindow ?? 0,
        }
      : null;

  const surv = survivorTierShock(dctx);
  let survivor: { year: number; fromTier: number; toTier: number; total: number } | null = null;
  if (surv && surv.impactedYears.length) {
    const survYear = surv.impactedYears[0]!;
    const idx = years.findIndex((y) => y.year === survYear);
    const toTier = representativeTierAt(years[idx]);
    let fromTier = toTier;
    for (let i = idx - 1; i >= 0; i--) {
      if (years[i]?.medicare) { fromTier = representativeTierAt(years[i]); break; }
    }
    survivor = { year: survYear, fromTier, toTier, total: surv.totalSurchargeOverWindow ?? 0 };
  }

  const narrative = buildMedicareNarrative({
    lifetimeMedicareCost: kpis.lifetimeMedicareCost,
    lifetimeIrmaa: kpis.lifetimeIrmaa,
    irmaaShare: kpis.irmaaShare,
    irmaaYears: kpis.irmaaYears,
    rmdEra,
    survivor,
    headroom,
  });

  const firstYear = bars.length ? bars[0]!.year : null;
  const lastYear = bars.length ? bars[bars.length - 1]!.year : null;
  const horizon = firstYear != null && lastYear != null ? `${firstYear}–${lastYear}` : "—";

  let subtitle = `${ctx.scenarioLabel} · Medicare years ${horizon}`;
  if (enrollment.client && enrollment.spouse) {
    subtitle += ` · Client enrolls ${enrollment.client.year}, Spouse ${enrollment.spouse.year}`;
  }

  return {
    title: "Medicare & IRMAA Summary",
    subtitle,
    isEmpty,
    kpis,
    bars,
    composition,
    tierLadder,
    headroom,
    enrollment,
    narrative,
  };
}
