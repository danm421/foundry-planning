"use client";

import { useEffect, useState } from "react";
import type { RiskAlignment } from "@/lib/insights/risk-capacity";
import type { Signal } from "@/lib/insights/signals";
import type { InsightAction } from "@/lib/insights/schemas";
import { Card, CardBody } from "@/components/card";
import MoneyText from "@/components/money-text";
import { RiskAlignmentScale } from "./risk-alignment-scale";
import { SignalsList } from "./signals-list";
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
  /** Recorded risk-tolerance rung on the same 0–100 growth-exposure axis as
   *  `risk`, or null when the household has no risk profile on file. */
  toleranceScore: number | null;
  signals: Signal[];
  stale: boolean;
  profile: {
    headline: string;
    snapshot: string;
    goals: string;
    actions: InsightAction[];
    talkingPoints: string[];
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
      <SignalsList signals={view.signals} />

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
            <span className="text-[11px] text-ink-3">Plan confidence</span>
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

      <RiskAlignmentScale risk={view.risk} tolerancePct={view.toleranceScore} />

      <GeneratePanel
        clientId={clientId}
        stale={view.stale}
        initial={view.profile}
        signals={view.signals}
      />
    </div>
  );
}
