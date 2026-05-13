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
import { TaxCellDrillDownModal } from "@/components/cashflow/tax-cell-drill-down-modal";
import { StateTaxDrillDownModal } from "@/components/cashflow/state-tax-drill-down-modal";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income";
import { TaxTabChart } from "@/components/cashflow/charts/tax-tab-chart";
import { buildIncomeCellDrill } from "@/lib/tax/cell-drill/income-breakdown";
import { buildConversionCellDrill } from "@/lib/tax/cell-drill/bracket-conversions";
import { buildBracketStackCellDrill } from "@/lib/tax/cell-drill/bracket-stacking";
import type {
  IncomeColumnKey,
  BracketColumnKey,
  CellDrillContext,
} from "@/lib/tax/cell-drill/types";

interface TaxDrillState {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
  totalTaxes: number;
}

type CellDrill =
  | { source: "income"; year: ProjectionYear; columnKey: IncomeColumnKey }
  | { source: "bracket"; year: ProjectionYear; columnKey: BracketColumnKey };

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
  const [stateDrill, setStateDrill] = useState<{
    year: number;
    state: StateIncomeTaxResult;
  } | null>(null);
  const [cellDrill, setCellDrill] = useState<CellDrill | null>(null);

  const ctx: CellDrillContext = useMemo(
    () => ({
      accountNames,
      incomes: clientData?.incomes ?? [],
      accounts: clientData?.accounts ?? [],
      entityNames: (clientData?.entities ?? []).reduce<Record<string, string>>(
        (acc, e) => {
          if (e.name) acc[e.id] = e.name;
          return acc;
        },
        {},
      ),
      rothConversionNames: (clientData?.rothConversions ?? []).reduce<Record<string, string>>(
        (acc, r) => {
          if (r.name) acc[r.id] = r.name;
          return acc;
        },
        {},
      ),
    }),
    [accountNames, clientData],
  );

  const drillProps = useMemo(() => {
    if (!cellDrill) return null;
    if (cellDrill.source === "income") {
      return buildIncomeCellDrill({
        year: cellDrill.year,
        columnKey: cellDrill.columnKey,
        ctx,
      });
    }
    if (cellDrill.columnKey === "intoBracket") {
      return buildBracketStackCellDrill({
        year: cellDrill.year,
        columnKey: cellDrill.columnKey,
        ctx,
      });
    }
    return buildConversionCellDrill({
      year: cellDrill.year,
      columnKey: cellDrill.columnKey,
      ctx,
    });
  }, [cellDrill, ctx]);

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
              if (activeTab === "state" && y.taxResult?.state) {
                setStateDrill({ year: y.year, state: y.taxResult.state });
                return;
              }
              if (y.taxDetail) {
                setTaxDrill({
                  year: y.year,
                  detail: y.taxDetail,
                  totalTaxes: y.expenses.taxes,
                });
              }
            }}
            onIncomeCellClick={(year, columnKey) =>
              setCellDrill({ source: "income", year, columnKey })
            }
            onBracketCellClick={(yr, columnKey) => {
              const year = years.find((y) => y.year === yr);
              if (year) setCellDrill({ source: "bracket", year, columnKey });
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
          entityNames={(clientData?.entities ?? []).reduce<Record<string, string>>(
            (acc, e) => {
              if (e.name) acc[e.id] = e.name;
              return acc;
            },
            {},
          )}
          onClose={() => setTaxDrill(null)}
        />
      )}

      {drillProps && (
        <TaxCellDrillDownModal
          {...drillProps}
          onClose={() => setCellDrill(null)}
        />
      )}

      {stateDrill && (
        <StateTaxDrillDownModal
          year={stateDrill.year}
          state={stateDrill.state}
          onClose={() => setStateDrill(null)}
        />
      )}
    </div>
  );
}
