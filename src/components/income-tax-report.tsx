"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine";
import DialogTabs from "@/components/dialog-tabs";
import {
  TAX_DETAIL_TABS,
  TaxDetailView,
  type TaxDetailTabId,
} from "@/components/cashflow/tax-detail-view";
import { TaxDrillDownModal } from "@/components/cashflow/tax-drill-down-modal";
import { TaxTabChart } from "@/components/cashflow/charts/tax-tab-chart";

interface TaxDrillState {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
  totalTaxes: number;
}

interface Props {
  clientId: string;
  scenarioId?: string | "base";
}

export default function IncomeTaxReport({ clientId }: Props) {
  const searchParams = useSearchParams();
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TaxDetailTabId>("income");
  const [taxDrill, setTaxDrill] = useState<TaxDrillState | null>(null);

  const planStartYear =
    clientData?.planSettings.planStartYear ?? new Date().getFullYear();
  const planEndYear =
    clientData?.planSettings.planEndYear ?? planStartYear + 50;

  const clientRetirementYear = useMemo(() => {
    if (!clientData?.client.dateOfBirth || !clientData?.client.retirementAge) {
      return null;
    }
    return (
      parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) +
      clientData.client.retirementAge
    );
  }, [clientData]);

  const [yearRange, setYearRange] = useState<[number, number]>([
    planStartYear,
    planEndYear,
  ]);

  useEffect(() => {
    setYearRange([planStartYear, planEndYear]);
  }, [planStartYear, planEndYear]);

  const visibleYears = useMemo(
    () => years.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]),
    [years, yearRange]
  );

  useEffect(() => {
    setClientData(null);
    setAccountNames({});
    setYears([]);
    setError(null);
    setLoading(true);

    async function load() {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const url = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ClientData;

        const names: Record<string, string> = {};
        for (const acc of data.accounts) {
          names[acc.id] = acc.name;
        }
        setAccountNames(names);
        setClientData(data);
        setYears(runProjection(data));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId, searchParams]);

  if (loading) {
    return <div className="p-6 text-ink-3">Loading…</div>;
  }
  if (error) {
    return <div className="p-6 text-crit">{error}</div>;
  }

  return (
    <div className="px-[var(--pad-card)] py-4">
      <header className="mb-4">
        <h1 className="text-[20px] font-semibold text-ink">Income Tax Model</h1>
        <p className="text-[12px] text-ink-3">
          Year-by-year tax breakdown across the projection.
        </p>
      </header>

      <div className="rounded-[var(--radius)] border border-hair bg-card">
        <DialogTabs
          tabs={TAX_DETAIL_TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TaxDetailTabId)}
        />
        <div className="p-6 space-y-4">
          <TaxTabChart activeTab={activeTab} years={visibleYears} />
          <TaxDetailView
            activeTab={activeTab}
            years={visibleYears}
            onYearClick={(y) => {
              if (y.taxDetail) {
                setTaxDrill({
                  year: y.year,
                  detail: y.taxDetail,
                  totalTaxes: y.expenses.taxes,
                });
              }
            }}
            yearRange={yearRange}
            onYearRangeChange={setYearRange}
            planStartYear={planStartYear}
            planEndYear={planEndYear}
            clientRetirementYear={clientRetirementYear}
            clientLifeExpectancy={clientData?.client.lifeExpectancy}
            spouseLifeExpectancy={clientData?.client.spouseLifeExpectancy}
          />
        </div>
      </div>

      {taxDrill && (
        <TaxDrillDownModal
          year={taxDrill.year}
          detail={taxDrill.detail}
          totalTaxes={taxDrill.totalTaxes}
          accountNames={accountNames}
          incomes={clientData?.incomes ?? []}
          onClose={() => setTaxDrill(null)}
        />
      )}
    </div>
  );
}
