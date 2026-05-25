"use client";
import type { ProjectionYear } from "@/engine";
import { MedicareMagiTierChart } from "./medicare-magi-tier-chart";

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

export function MedicareTab({ years, yearRange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <MedicareMagiTierChart years={years} yearRange={yearRange} />
      <div className="text-sm text-ink-3">Year-by-year table populated in task 14.</div>
    </div>
  );
}
