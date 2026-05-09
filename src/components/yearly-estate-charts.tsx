"use client";

import { useMemo } from "react";
import type { YearlyEstateRow } from "@/lib/estate/yearly-estate-report";
import type { RecipientTotal } from "@/lib/estate/transfer-report";
import { assignRecipientColors } from "./estate-transfer-chart-colors";
import { YearlyEstateWhereChart } from "./yearly-estate-where-chart";
import { YearlyEstateBeneficiaryChart } from "./yearly-estate-beneficiary-chart";

interface Props {
  rows: YearlyEstateRow[];
  /** Non-spouse recipient totals from a split-mode call to
   *  buildEstateTransferReportData (actual projected death years). */
  recipients: RecipientTotal[];
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

export function YearlyEstateCharts({
  rows,
  recipients,
  firstDeathYear,
  secondDeathYear,
}: Props) {
  const colors = useMemo(
    () => assignRecipientColors(recipients),
    [recipients],
  );

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
            End beneficiaries — at projected deaths
          </p>
          <YearlyEstateBeneficiaryChart
            recipients={recipients}
            colors={colors}
            firstDeathYear={firstDeathYear}
            secondDeathYear={secondDeathYear}
          />
        </div>
      </div>
    </section>
  );
}
