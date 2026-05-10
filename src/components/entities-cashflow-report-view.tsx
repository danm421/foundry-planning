"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear, Income, Expense, EntityFlowOverride, ClientInfo } from "@/engine/types";
import HeaderControls, { type EntityOption } from "./entities-cashflow-report/header-controls";
import TrustTable from "./entities-cashflow-report/trust-table";
import BusinessTable from "./entities-cashflow-report/business-table";
import EntityLedgerModal from "./entities-cashflow-report/entity-ledger-modal";
import { selectEntityRows, type SelectedRows } from "./entities-cashflow-report/view-model";
import {
  getEntityLedger,
  type EntityLedger,
  type LedgerSection,
} from "@/lib/entity-ledger";
import type { EntityMetadata } from "@/engine/entity-cashflow";

interface Props {
  clientId: string;
  entities: EntityOption[];
}

interface ApiData {
  accounts: {
    id: string;
    name: string;
    owners?: Array<
      | { kind: "family_member"; familyMemberId: string; percent: number }
      | { kind: "entity"; entityId: string; percent: number }
    >;
  }[];
  entities: {
    id: string;
    name: string;
    entityType?: string;
    valueGrowthRate?: number;
    flowMode?: string;
    value?: number;
    basis?: number;
    isGrantor?: boolean;
    trustSubType?: string;
  }[];
  incomes: Income[];
  expenses: Expense[];
  entityFlowOverrides?: EntityFlowOverride[];
  client?: ClientInfo;
}

export default function EntitiesCashFlowReportView({ clientId, entities }: Props) {
  const searchParams = useSearchParams();
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [apiData, setApiData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState(entities[0]?.id ?? "");
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [clientRetirementYear, setClientRetirementYear] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [openLedger, setOpenLedger] = useState<{
    entityId: string;
    entityName: string;
    year: number;
    section: LedgerSection;
  } | null>(null);

  useEffect(() => {
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
        const data = await res.json();
        const projection = runProjection(data);
        setYears(projection);
        setApiData(data as ApiData);
        if (projection.length > 0) {
          setYearRange([projection[0].year, projection[projection.length - 1].year]);
        }
        // Surface client's retirement year for the slider's preset highlighter.
        // ClientData.client carries `dateOfBirth` (YYYY-MM-DD) and `retirementAge`
        // — same pattern as cashflow-report.tsx / income-tax-report.tsx.
        const client = (data as { client?: { dateOfBirth?: string | null; retirementAge?: number | null } }).client;
        if (client?.dateOfBirth && client.retirementAge) {
          setClientRetirementYear(parseInt(client.dateOfBirth.slice(0, 4), 10) + client.retirementAge);
        } else {
          setClientRetirementYear(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [clientId, searchParams]);

  const selected = useMemo<SelectedRows>(() => {
    if (!yearRange) return { kind: "empty", rows: [] };
    return selectEntityRows({
      years,
      entityId: selectedEntityId,
      startYear: yearRange[0],
      endYear: yearRange[1],
    });
  }, [years, selectedEntityId, yearRange]);

  const ledgerLookups = useMemo(() => {
    if (!apiData) return null;
    const entitiesById = new Map<string, EntityMetadata>(
      apiData.entities.map((e) => [
        e.id,
        {
          id: e.id,
          name: e.name,
          entityType: (e.entityType ?? "other") as EntityMetadata["entityType"],
          trustSubType: (e.trustSubType ?? null) as EntityMetadata["trustSubType"],
          isGrantor: e.isGrantor ?? false,
          initialValue: e.value ?? 0,
          initialBasis: e.basis ?? 0,
          flowMode: (e.flowMode ?? "annual") as EntityMetadata["flowMode"],
          valueGrowthRate: e.valueGrowthRate ?? null,
        },
      ]),
    );
    const accountNamesById = new Map(apiData.accounts.map((a) => [a.id, a.name]));
    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>();
    for (const a of apiData.accounts) {
      for (const o of a.owners ?? []) {
        if (o.kind === "entity") {
          accountEntityOwners.set(a.id, { entityId: o.entityId, percent: o.percent });
        }
      }
    }
    return { entitiesById, accountNamesById, accountEntityOwners };
  }, [apiData]);

  const ledger = useMemo<EntityLedger | null>(() => {
    if (!openLedger || !apiData || !ledgerLookups) return null;
    const yr = years.find((y) => y.year === openLedger.year);
    if (!yr) return null;
    return getEntityLedger(openLedger.entityId, {
      year: yr,
      planStartYear: years[0]?.year ?? openLedger.year,
      entitiesById: ledgerLookups.entitiesById,
      accountNamesById: ledgerLookups.accountNamesById,
      accountEntityOwners: ledgerLookups.accountEntityOwners,
      incomes: apiData.incomes,
      expenses: apiData.expenses,
      entityFlowOverrides: apiData.entityFlowOverrides ?? [],
      client: apiData.client,
    });
  }, [openLedger, apiData, ledgerLookups, years]);

  const onExportPdf = async () => {
    setExporting(true);
    try {
      const [{ pdf }, { default: Document }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./entities-cashflow-report-pdf/document"),
      ]);
      const entityName = entities.find((e) => e.id === selectedEntityId)?.name ?? "Entity";
      const blob = await pdf(<Document selected={selected} entityName={entityName} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `entities-cashflow-${selectedEntityId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-400">Error: {error}</div>;
  if (entities.length === 0) {
    return <div className="p-6 text-sm text-gray-400">No trusts or businesses on file.</div>;
  }

  const currentYear = new Date().getFullYear();
  const minYear = years[0]?.year ?? currentYear;
  const maxYear = years[years.length - 1]?.year ?? currentYear;

  return (
    <div className="flex flex-col gap-0">
      <HeaderControls
        entities={entities}
        selectedEntityId={selectedEntityId}
        onSelectEntity={setSelectedEntityId}
        yearRange={yearRange ?? [minYear, maxYear]}
        minYear={minYear}
        maxYear={maxYear}
        clientRetirementYear={clientRetirementYear}
        onYearRangeChange={setYearRange}
        exporting={exporting}
        onExportPdf={onExportPdf}
      />
      <div className="p-4">
        {selected.kind === "trust" && (
          <TrustTable
            rows={selected.rows}
            currentYear={currentYear}
            onCellClick={(row, section) =>
              setOpenLedger({
                entityId: row.entityId,
                entityName: row.entityName,
                year: row.year,
                section,
              })
            }
          />
        )}
        {selected.kind === "business" && (
          <BusinessTable
            rows={selected.rows}
            currentYear={currentYear}
            onCellClick={(row, section) =>
              setOpenLedger({
                entityId: row.entityId,
                entityName: row.entityName,
                year: row.year,
                section,
              })
            }
          />
        )}
        {selected.kind === "empty" && (
          <div className="text-sm text-gray-400">No activity for this entity in the selected year range.</div>
        )}
      </div>
      {openLedger && ledger && (() => {
        let total: number | null = null;
        if (selected.kind === "business") {
          const row = selected.rows.find((r) => r.year === openLedger.year);
          if (!row) return null;
          if (openLedger.section === "growth") total = row.growth;
          else if (openLedger.section === "income") total = row.income;
          else if (openLedger.section === "expenses") total = row.expenses;
          else total = row.endingTotalValue;
        } else if (selected.kind === "trust") {
          const row = selected.rows.find((r) => r.year === openLedger.year);
          if (!row) return null;
          if (openLedger.section === "growth") total = row.growth;
          else if (openLedger.section === "income") total = row.income;
          else if (openLedger.section === "expenses") total = row.expenses;
          else total = row.endingBalance;
        }
        if (total === null) return null;

        return (
          <EntityLedgerModal
            open={true}
            onClose={() => setOpenLedger(null)}
            entityName={openLedger.entityName}
            year={openLedger.year}
            section={openLedger.section}
            rows={ledger[openLedger.section]}
            total={total}
          />
        );
      })()}
    </div>
  );
}
