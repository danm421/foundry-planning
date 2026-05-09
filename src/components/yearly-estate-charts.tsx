"use client";

import { useMemo } from "react";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";
import type { YearlyBeneficiaryBreakdown } from "@/lib/estate/yearly-beneficiary-breakdown";
import { assignRecipientColors } from "./estate-transfer-chart-colors";
import { YearlyEstateWhereChart } from "./yearly-estate-where-chart";
import { YearlyEstateBeneficiaryChart } from "./yearly-estate-beneficiary-chart";
import type { RecipientTotal } from "@/lib/estate/transfer-report";

interface Props {
  rows: YearlyEstateRow[];
  breakdown: YearlyBeneficiaryBreakdown;
}

export function YearlyEstateCharts({ rows, breakdown }: Props) {
  // assignRecipientColors expects RecipientTotal[]; we only need a stable key
  // and recipientKind to pick a palette slot. Adapt the breakdown's
  // beneficiaries list to the minimum-viable RecipientTotal shape.
  const colors = useMemo(() => {
    const adapted: RecipientTotal[] = breakdown.beneficiaries.map((b) => ({
      key: b.key,
      recipientLabel: b.recipientLabel,
      recipientKind: b.recipientKind,
      fromFirstDeath: 0,
      fromSecondDeath: 0,
      total: b.lifetimeTotal,
    }));
    return assignRecipientColors(adapted);
  }, [breakdown.beneficiaries]);

  if (rows.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Where it ends up — by year
          </span>
          <h2 className="text-base font-semibold text-gray-50">
            Estate transfer at-a-glance
          </h2>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-5 px-5 py-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
            Where the estate goes
          </p>
          <YearlyEstateWhereChart rows={rows} />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
            End beneficiaries — 1st vs 2nd death
          </p>
          <YearlyEstateBeneficiaryChart breakdown={breakdown} colors={colors} />
        </div>
      </div>
    </section>
  );
}
