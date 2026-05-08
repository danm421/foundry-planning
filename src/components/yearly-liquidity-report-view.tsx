"use client";

import type { OwnerDobs } from "./report-controls/age-helpers";

interface Props {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
}

export default function YearlyLiquidityReportView(_props: Props) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
      Liquidity report coming up.
    </div>
  );
}
