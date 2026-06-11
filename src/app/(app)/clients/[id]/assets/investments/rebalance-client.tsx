"use client";

import { useState } from "react";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";

export interface RebalanceClientProps {
  clientId: string;
  accountsWithHoldings: { id: string; name: string; category: string; value: number }[];
  fundPortfolios: { id: string; name: string }[];
  assetClasses: { id: string; name: string }[];
}

export function RebalanceClient({}: RebalanceClientProps) {
  const [result, setResult] = useState<RebalanceComputeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // result, setResult, setLoading, setError consumed in Tasks 11-13
  void result;
  void setResult;
  void setLoading;
  void setError;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">
        Model moving the selected holdings into a fund portfolio.
      </p>
      {/* SourceSelector (Task 11) */}
      {/* TargetSelector (Task 12) */}
      {/* ComparisonPanels (Task 13) */}
      {error && <p className="text-sm text-crit">{error}</p>}
      {loading && <p className="text-sm text-ink-3">Computing…</p>}
    </div>
  );
}
