"use client";

import { useState } from "react";
import type { RebalanceComputeResult } from "@/lib/investments/rebalance/types";
import { RebalanceSource } from "./rebalance-source";
import { RebalanceTarget, type RebalanceTargetValue } from "./rebalance-target";
import { RebalanceComparison } from "./rebalance-comparison";

export interface RebalanceClientProps {
  clientId: string;
  accountsWithHoldings: { id: string; name: string; category: string; value: number }[];
  fundPortfolios: { id: string; name: string }[];
}

export function RebalanceClient({
  clientId,
  accountsWithHoldings,
  fundPortfolios,
}: RebalanceClientProps) {
  const [result, setResult] = useState<RebalanceComputeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [target, setTarget] = useState<RebalanceTargetValue | null>(null);
  const [unresolvedTickers, setUnresolvedTickers] = useState<string[]>([]);

  // ── Compute ────────────────────────────────────────────────────────────────

  async function runCompute(overrideRate?: number) {
    if (!target || selectedIds.length === 0) return;
    setLoading(true);
    setError(null);
    setUnresolvedTickers([]);
    try {
      let computeTarget:
        | { portfolioId: string }
        | { holdings: { ticker: string; weight: number }[] };

      if (target.kind === "existing") {
        computeTarget = { portfolioId: target.portfolioId };
      } else if (target.saveToCma) {
        // 1) create the portfolio, 2) save holdings (weights 0..1, sum 1.0), 3) compute against it
        const name = target.name?.trim();
        if (!name) throw new Error("Enter a name to save the fund portfolio.");
        const createRes = await fetch("/api/cma/ticker-portfolios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!createRes.ok)
          throw new Error((await createRes.json()).error ?? "Could not create fund portfolio");
        const created = await createRes.json();

        const putRes = await fetch(`/api/cma/ticker-portfolios/${created.id}/holdings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdings: target.holdings.map((h) => ({
              displayTicker: h.ticker,
              weight: h.weight,
            })),
          }),
        });
        if (!putRes.ok)
          throw new Error((await putRes.json()).error ?? "Could not save holdings");

        // Switch to "existing" so a re-run doesn't re-create the portfolio
        setTarget({ kind: "existing", portfolioId: created.id });
        computeTarget = { portfolioId: created.id };
      } else {
        computeTarget = { holdings: target.holdings };
      }

      const body = {
        accountIds: selectedIds,
        target: computeTarget,
        ...(overrideRate != null ? { overrideLtcgRate: overrideRate } : {}),
      };

      const res = await fetch(`/api/clients/${clientId}/rebalance/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (Array.isArray(data.unresolvedTickers) && data.unresolvedTickers.length > 0) {
          setUnresolvedTickers(data.unresolvedTickers as string[]);
        }
        throw new Error(data.error ?? "Compute failed");
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compute failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Compute button enablement ──────────────────────────────────────────────

  const newTargetTotal =
    target?.kind === "new" ? target.holdings.reduce((s, h) => s + h.weight, 0) : 0;
  const weightsValid =
    target?.kind !== "new" ||
    (target.holdings.length > 0 && Math.abs(newTargetTotal - 1) < 0.001);
  const canCompute = selectedIds.length > 0 && target !== null && weightsValid;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <p className="text-sm text-ink-3">
        Model moving the selected holdings into a fund portfolio.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <RebalanceSource
          accounts={accountsWithHoldings}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />

        <RebalanceTarget
          fundPortfolios={fundPortfolios}
          value={target}
          onChange={setTarget}
          unresolvedTickers={unresolvedTickers}
        />
      </div>

      <button
        type="button"
        onClick={() => void runCompute()}
        disabled={!canCompute || loading}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
      >
        {loading ? "Computing…" : "Compute"}
      </button>

      {!weightsValid && target?.kind === "new" && target.holdings.length > 0 && (
        <p className="text-xs text-warn">Target weights must total 100% to compute.</p>
      )}

      {error && <p className="text-sm text-crit">{error}</p>}

      {result && (
        <RebalanceComparison result={result} onOverrideRate={(r) => void runCompute(r)} />
      )}
    </div>
  );
}
