"use client";

import { useMemo } from "react";
import type { ProjectionYear, ClientData } from "@/engine";
import { rmdEraTierWarning } from "@/lib/medicare/detectors/rmd-era-tier-warning";
import { survivorTierShock } from "@/lib/medicare/detectors/survivor-tier-shock";
import { duplicateHealthExpense } from "@/lib/medicare/detectors/duplicate-health-expense";

interface Props {
  years: ProjectionYear[];
  clientData: ClientData;
}

export function MedicareCallouts({ years, clientData }: Props) {
  const callouts = useMemo(() => {
    const ctx = {
      years,
      expenses: clientData.expenses.map((e) => ({
        id: e.id,
        name: e.name,
        annualAmount: e.annualAmount,
        startYear: e.startYear,
        endYear: e.endYear,
        endsAtMedicareEligibilityOwner: e.endsAtMedicareEligibilityOwner ?? null,
      })),
      medicareCoverage: clientData.medicareCoverage ?? [],
      rmdStartAges: { client: 73, spouse: 73 },
    };
    return [
      rmdEraTierWarning(ctx),
      survivorTierShock(ctx),
      duplicateHealthExpense(ctx),
    ].filter((c): c is NonNullable<typeof c> => c !== null);
  }, [years, clientData]);

  if (callouts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {callouts.map((c) => {
        const styles =
          c.severity === "alert"
            ? "border-crit bg-crit/10 text-crit"
            : c.severity === "warning"
              ? "border-warn bg-warn/10 text-warn"
              : "border-data-indigo bg-data-indigo/10 text-ink";
        return (
          <div key={c.id} className={`rounded border ${styles} px-4 py-3 text-sm`}>
            <div className="font-medium">{c.title}</div>
            <div className="text-[13px] mt-1">{c.body}</div>
            {c.action && (
              <a href={c.action.href} className="inline-block mt-2 underline text-[12px]">
                {c.action.label}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
