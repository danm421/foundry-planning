"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useViewParam } from "@/hooks/use-view-param";
import IncomeTaxSkeleton from "@/app/(app)/clients/[id]/cashflow/income-tax/loading-skeleton";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine";
import type { MedicareCoverage } from "@/engine/types";
import { MedicareSetupDialog } from "@/components/medicare/medicare-setup-dialog";
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
import { equityPlanLabel } from "@/lib/tax/cell-drill/equity-plan-label";
import type {
  IncomeColumnKey,
  BracketColumnKey,
  CellDrillContext,
} from "@/lib/tax/cell-drill/types";

interface TaxDrillState {
  year: number;
  detail: NonNullable<ProjectionYear["taxDetail"]>;
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
  const scenarioParam = searchParams?.get("scenario") ?? null;
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useViewParam<TaxDetailTabId>(
    TAX_DETAIL_TABS.map((t) => t.id),
    "income",
  );
  const [taxDrill, setTaxDrill] = useState<TaxDrillState | null>(null);
  const [stateDrill, setStateDrill] = useState<{
    year: number;
    state: StateIncomeTaxResult;
  } | null>(null);
  const [cellDrill, setCellDrill] = useState<CellDrill | null>(null);

  const [showMigrationBanner, setShowMigrationBanner] = useState(false);
  const migrationBannerKey = `medicare-migration-banner-dismissed:${clientId}`;

  useEffect(() => {
    if (!localStorage.getItem(migrationBannerKey)) {
      setShowMigrationBanner(true);
    }
  }, [migrationBannerKey]);

  function dismissBanner() {
    localStorage.setItem(migrationBannerKey, String(Date.now()));
    setShowMigrationBanner(false);
  }

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
      noteNames: (clientData?.notesReceivable ?? []).reduce<Record<string, string>>(
        (acc, n) => {
          if (n.name) acc[n.id] = n.name;
          return acc;
        },
        {},
      ),
      equityPlanNames: (clientData?.stockOptionPlans ?? []).reduce<Record<string, string>>(
        (acc, p) => {
          if (p.accountId) acc[p.accountId] = equityPlanLabel(p);
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

  // Optimistic + persist: update client-side data, re-run projection, fire-and-forget PUT.
  // Surface a non-fatal error if persistence fails so the user knows their change
  // isn't saved — local state still reflects the new value either way.
  const [assumptionSaveError, setAssumptionSaveError] = useState<string | null>(null);
  const [medicareSetupOpen, setMedicareSetupOpen] = useState(false);

  const coverage = clientData?.medicareCoverage ?? [];
  const estimateMagi =
    coverage.length > 0 && coverage.every((c) => c.estimatePriorYearMagiFromProjection);

  function upsertCoverageLocally(next: MedicareCoverage) {
    if (!clientData) return;
    const existing = clientData.medicareCoverage ?? [];
    const idx = existing.findIndex((c) => c.owner === next.owner);
    const nextCoverage =
      idx >= 0
        ? existing.map((c, i) => (i === idx ? next : c))
        : [...existing, next];
    const updated: ClientData = { ...clientData, medicareCoverage: nextCoverage };
    setClientData(updated);
    setYears(runProjection(updated));
  }

  const handleEstimateMagiChange = (value: boolean) => {
    if (!clientData) return;
    const existing = clientData.medicareCoverage ?? [];
    const nextCoverage = existing.map((c) => ({
      ...c,
      estimatePriorYearMagiFromProjection: value,
    }));
    const updated: ClientData = { ...clientData, medicareCoverage: nextCoverage };
    setClientData(updated);
    setYears(runProjection(updated));
    setAssumptionSaveError(null);
    Promise.all(
      nextCoverage.map((c) =>
        fetch(`/api/clients/${clientId}/medicare-coverage`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }),
      ),
    )
      .then(async (responses) => {
        for (const res of responses) {
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string };
            setAssumptionSaveError(err.error ?? `Save failed (HTTP ${res.status})`);
            return;
          }
        }
      })
      .catch((e) => {
        setAssumptionSaveError(e instanceof Error ? e.message : "Save failed");
      });
  };

  const handleMedicareInflationChange = (next: { rate?: number; enabled?: boolean }) => {
    if (!clientData) return;
    const updated: ClientData = {
      ...clientData,
      medicarePremiumInflationRate:
        next.rate !== undefined ? next.rate : clientData.medicarePremiumInflationRate,
      medicarePremiumInflationEnabled:
        next.enabled !== undefined ? next.enabled : clientData.medicarePremiumInflationEnabled,
    };
    setClientData(updated);
    setYears(runProjection(updated));
    setAssumptionSaveError(null);
    const body: Record<string, number | boolean> = {};
    if (next.rate !== undefined) body.medicarePremiumInflationRate = next.rate;
    if (next.enabled !== undefined) body.medicarePremiumInflationEnabled = next.enabled;
    fetch(`/api/clients/${clientId}/plan-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setAssumptionSaveError(err.error ?? `Save failed (HTTP ${res.status})`);
        }
      })
      .catch((e) => {
        setAssumptionSaveError(e instanceof Error ? e.message : "Save failed");
      });
  };

  useEffect(() => {
    setClientData(null);
    setAccountNames({});
    setYears([]);
    setError(null);
    setLoading(true);

    async function load() {
      try {
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
  }, [clientId, scenarioParam]);

  if (loading) {
    return <IncomeTaxSkeleton />;
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

      {showMigrationBanner && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex items-start gap-3">
          <div className="flex-1">
            <div className="font-medium">Medicare premiums are now auto-projected.</div>
            <div className="text-[12px] mt-1">
              The Medicare &amp; IRMAA tab projects per-person Part B + IRMAA + Medigap costs and adds them to cash-flow expenses. Review any existing health-insurance expense lines for double-counting.
            </div>
          </div>
          <button onClick={dismissBanner} className="text-blue-700 hover:underline text-[12px]">
            Dismiss
          </button>
        </div>
      )}

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
            clientData={clientData}
            clientId={clientId}
            onMedicareInflationChange={handleMedicareInflationChange}
            medicareAssumptionSaveError={assumptionSaveError}
            estimateMagi={estimateMagi}
            onEstimateMagiChange={handleEstimateMagiChange}
            onEnableMedicare={() => setMedicareSetupOpen(true)}
          />
        </div>
      </div>

      {taxDrill && (
        <TaxDrillDownModal
          year={taxDrill.year}
          detail={taxDrill.detail}
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

      {medicareSetupOpen && clientData && (
        <MedicareSetupDialog
          clientId={clientId}
          ownerDobs={{
            client: clientData?.client?.dateOfBirth ?? null,
            spouse: clientData?.client?.spouseDob ?? null,
          }}
          hasSpouse={years.some((y) => y.ages.spouse != null)}
          onClose={() => setMedicareSetupOpen(false)}
          onSaved={(saved) => {
            upsertCoverageLocally(saved);
            setMedicareSetupOpen(false);
          }}
        />
      )}
    </div>
  );
}
