"use client";

import { useEffect, useState } from "react";
import type { RiskAlignment } from "@/lib/insights/risk-capacity";
import type { Signal } from "@/lib/insights/signals";
import type { InsightAction } from "@/lib/insights/schemas";
import {
  MetricBlock,
  SectionLabel,
  fmtInt,
  fmtMoney,
  fmtPct,
} from "@/components/crm-section-primitives";
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

/** One cell of the segmented KPI strip. */
function KpiCell({
  label,
  value,
  support,
}: {
  label: string;
  value: string;
  support?: string;
}) {
  return (
    <div className="min-w-0 flex-1 border-hair px-5 py-4 [&:not(:first-child)]:border-l">
      <MetricBlock label={label} value={value} support={support} size="md" />
    </div>
  );
}

/**
 * The client 360 — KPIs, deterministic signals, risk alignment and the AI
 * narrative. It used to be its own "360 AI" tab; it now heads the Overview tab,
 * so the household's most useful screen is also its landing screen.
 *
 * The view is still fetched lazily on mount rather than server-rendered: the
 * battery behind it runs an overview projection plus Monte Carlo, so the
 * household page paints first and this band fills in.
 *
 * `clientId` is the linked planning client — this only renders for households
 * that have one.
 */
export function Household360({ clientId }: { clientId: string }) {
  const [view, setView] = useState<InsightsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <section className="flex flex-col gap-4">
        <SectionLabel segments={["360", "Client snapshot"]} />
        <div
          role="status"
          aria-live="polite"
          className="rounded-[var(--radius)] border border-hair-2 px-5 py-8 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3"
        >
          Loading 360…
        </div>
      </section>
    );
  }

  if (error || !view) {
    return (
      <section className="flex flex-col gap-4">
        <SectionLabel segments={["360", "Client snapshot"]} />
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-crit/40 bg-crit/10 px-5 py-4 text-[13px] text-crit"
        >
          {error ?? "Failed to load 360"}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionLabel segments={["360", "Client snapshot"]} />

      <div className="flex flex-wrap rounded-[var(--radius)] border border-hair-2 bg-card">
        <KpiCell label="Net worth" value={fmtMoney(view.kpis.netWorth)} />
        <KpiCell label="Liquid portfolio" value={fmtMoney(view.kpis.liquidPortfolio)} />
        <KpiCell label="Years to retire" value={fmtInt(view.kpis.yearsToRetirement)} />
        <KpiCell label="Plan confidence" value={fmtPct(view.kpis.mcSuccessRate)} />
        <KpiCell
          label="Funding"
          value={view.kpis.fundingScore.toFixed(2)}
          support="1.00 = fully funded"
        />
      </div>

      <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(400px,1fr))]">
        <div className="flex min-w-0 flex-col gap-3">
          <SignalsList signals={view.signals} />
        </div>
        <div className="min-w-0">
          <RiskAlignmentScale risk={view.risk} tolerancePct={view.toleranceScore} />
        </div>
      </div>

      <GeneratePanel
        clientId={clientId}
        stale={view.stale}
        initial={view.profile}
        signals={view.signals}
      />
    </section>
  );
}
