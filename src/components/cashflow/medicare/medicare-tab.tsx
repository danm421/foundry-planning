"use client";
import type { ProjectionYear } from "@/engine";

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

export function MedicareTab({ years }: Props) {
  return (
    <div className="text-sm text-ink-2">
      Medicare & IRMAA report — populated in tasks 13–15.
      <div className="text-[11px] text-ink-3 mt-2">
        {years.length} projection years loaded.
      </div>
    </div>
  );
}
