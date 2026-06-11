"use client";

import { useState } from "react";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";
import { RebalanceSource } from "./rebalance-source";

export interface RebalanceClientProps {
  clientId: string;
  accountsWithHoldings: { id: string; name: string; category: string; value: number }[];
  fundPortfolios: { id: string; name: string }[];
  assetClasses: { id: string; name: string }[];
}

export function RebalanceClient({ accountsWithHoldings }: RebalanceClientProps) {
  const [result, setResult] = useState<RebalanceComputeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // result, setResult, setLoading, setError consumed in Tasks 12-13
  void result;
  void setResult;
  void setLoading;
  void setError;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">
        Model moving the selected holdings into a fund portfolio.
      </p>
      <RebalanceSource
        accounts={accountsWithHoldings}
        selectedIds={selectedIds}
        onChange={setSelectedIds}
      />
      {/* TargetSelector (Task 12) */}
      {/* ComparisonPanels (Task 13) */}
      {error && <p className="text-sm text-crit">{error}</p>}
      {loading && <p className="text-sm text-ink-3">Computing…</p>}
    </div>
  );
}
