"use client";

import { useEffect, useState } from "react";
import type { RiskAlignment } from "@/lib/insights/risk-capacity";
import type { LintFinding } from "@/lib/insights/lint";
import { Card, CardBody } from "@/components/card";
import MoneyText from "@/components/money-text";
import { RiskAlignmentScale } from "./risk-alignment-scale";
import { GeneratePanel } from "./generate-panel";

interface InsightsView {
  kpis: {
    netWorth: number;
    liquidPortfolio: number;
    yearsToRetirement: number | null;
    mcSuccessRate: number | null;
    fundingScore: number;
  };
  risk: RiskAlignment;
  needsAttention: LintFinding[];
  stale: boolean;
  profile: {
    snapshot: string;
    goals: string;
    opportunities: string;
    generatedAt: string;
  } | null;
}

/**
 * CRM household "360 AI" tab. Fetches the 360 view lazily on mount (i.e. when
 * the tab is opened) so the heavy battery compute stays off the household page's
 * default load. `clientId` is the linked planning client — the tab is only
 * rendered for households that have one.
 */
export function InsightsTab({ clientId }: { clientId: string }) {
  const [view, setView] = useState<InsightsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch on mount (i.e. when the tab is opened). `loading`/`error`/`view` start
  // at their loading defaults, so no synchronous reset is needed here — the tab
  // mounts fresh each time it's selected.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/insights`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return (await res.json()) as InsightsView;
      })
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load 360");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) return <div className="p-6 text-ink-3">Loading 360…</div>;
  if (error || !view) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 p-4 text-sm text-crit"
      >
        {error ?? "Failed to load 360"}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {view.needsAttention.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-warn/30 bg-warn/10 p-4">
          <h3 className="mb-2 text-sm font-semibold text-warn">Needs attention</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {view.needsAttention.map((f) => (
              <li key={f.kind}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Net worth</span>
            <MoneyText value={view.kpis.netWorth} format="currency" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Yrs to retire</span>
            <MoneyText value={view.kpis.yearsToRetirement} format="int" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">MC success</span>
            <MoneyText value={view.kpis.mcSuccessRate} format="pct" size="kpi" />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-3">Funding</span>
            <span className="tabular text-[30px] font-medium tracking-[-0.03em]">
              {view.kpis.fundingScore.toFixed(2)}
            </span>
          </CardBody>
        </Card>
      </div>

      <RiskAlignmentScale risk={view.risk} />

      <GeneratePanel
        clientId={clientId}
        stale={view.stale}
        initial={view.profile}
      />
    </div>
  );
}
