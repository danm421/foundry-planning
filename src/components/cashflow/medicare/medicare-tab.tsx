"use client";
import { useState } from "react";
import type { ProjectionYear } from "@/engine";
import { MedicareMagiTierChart } from "./medicare-magi-tier-chart";
import { MedicareYearTable } from "./medicare-year-table";

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

export function MedicareTab({ years, yearRange }: Props) {
  const [_clickedYear, _setClickedYear] = useState<ProjectionYear | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <MedicareMagiTierChart years={years} yearRange={yearRange} />
      <MedicareYearTable years={years} yearRange={yearRange} onRowClick={_setClickedYear} />
      <p className="text-[11px] text-ink-3">
        * Cold-start: prior-year MAGI not yet projected; uses entered prior-year value or year-0 MAGI proxy.
      </p>
    </div>
  );
}
