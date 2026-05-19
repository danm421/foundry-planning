"use client";

// Life Insurance solver tab.
//
// Task 9 scaffold: this wires the tab into the solver workspace and seeds
// the assumptions state from persisted settings. Tasks 10 and 11 fill in
// the real UI (assumptions panel + debounced solve, need cards + chart).
// The <pre> debug dump below is intentional scaffolding — Task 11 removes it.
import { useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

interface Props {
  clientId: string;
  settings: LiAssumptions;
}

export function SolverTabLifeInsurance({ clientId, settings }: Props) {
  const [assumptions] = useState<LiAssumptions>(settings);

  return (
    <div className="space-y-4 px-3 py-4">
      <h2 className="text-[15px] font-medium text-ink">Life Insurance Need</h2>

      {/* (1) Assumptions panel — filled in by Task 10. */}

      {/* (2) Need result cards — filled in by Task 11. */}

      {/* (3) Need-over-time chart — filled in by Task 11. */}

      {/* Debug dump — confirms the assumptions wiring; removed by Task 11. */}
      <pre className="overflow-x-auto rounded-md border border-hair-2 bg-card-2 p-3 text-[12px] text-ink-3">
        {JSON.stringify({ clientId, assumptions }, null, 2)}
      </pre>
    </div>
  );
}
