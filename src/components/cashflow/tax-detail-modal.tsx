"use client";

import { useMemo, useState } from "react";
import type { ProjectionYear } from "@/engine";
import {
  TAX_DETAIL_TABS,
  TaxDetailView,
  type TaxDetailTabId,
} from "./tax-detail-view";
import DialogShell from "@/components/dialog-shell";
import { TaxCellDrillDownModal } from "./tax-cell-drill-down-modal";
import { buildIncomeCellDrill } from "@/lib/reports/tax-cell-drill/income-breakdown";
import { buildConversionCellDrill } from "@/lib/reports/tax-cell-drill/bracket-conversions";
import { buildBracketStackCellDrill } from "@/lib/reports/tax-cell-drill/bracket-stacking";
import type {
  IncomeColumnKey,
  BracketColumnKey,
  CellDrillContext,
} from "@/lib/reports/tax-cell-drill/types";
import type { Income, Account, EntitySummary, RothConversion } from "@/engine/types";

interface TaxDetailModalProps {
  years: ProjectionYear[];
  onClose: () => void;
  onYearClick: (year: ProjectionYear) => void;
  // Year-range slider — shared with the cashflow page so changes flow both ways
  yearRange: [number, number];
  onYearRangeChange: (next: [number, number]) => void;
  planStartYear: number;
  planEndYear: number;
  clientRetirementYear: number | null;
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
  clientData: {
    incomes: Income[];
    accounts: Account[];
    entities?: EntitySummary[];
    rothConversions?: RothConversion[];
  };
}

type CellDrill =
  | { source: "income"; year: ProjectionYear; columnKey: IncomeColumnKey }
  | { source: "bracket"; year: ProjectionYear; columnKey: BracketColumnKey };

export function TaxDetailModal(props: TaxDetailModalProps) {
  const {
    years, onClose, onYearClick,
    yearRange, onYearRangeChange,
    planStartYear, planEndYear,
    clientRetirementYear, clientLifeExpectancy, spouseLifeExpectancy,
    clientData,
  } = props;
  const [activeTab, setActiveTab] = useState<TaxDetailTabId>("income");
  const [cellDrill, setCellDrill] = useState<CellDrill | null>(null);

  const ctx: CellDrillContext = useMemo(
    () => ({
      accountNames: Object.fromEntries(clientData.accounts.map((a) => [a.id, a.name])),
      incomes: clientData.incomes,
      accounts: clientData.accounts,
      entityNames: (clientData.entities ?? []).reduce<Record<string, string>>(
        (acc, e) => {
          if (e.name) acc[e.id] = e.name;
          return acc;
        },
        {},
      ),
      rothConversionNames: (clientData.rothConversions ?? []).reduce<Record<string, string>>(
        (acc, r) => {
          if (r.name) acc[r.id] = r.name;
          return acc;
        },
        {},
      ),
    }),
    [clientData.accounts, clientData.incomes, clientData.entities, clientData.rothConversions],
  );

  const drillProps = useMemo(() => {
    if (!cellDrill) return null;
    if (cellDrill.source === "income") {
      return buildIncomeCellDrill({ year: cellDrill.year, columnKey: cellDrill.columnKey, ctx });
    }
    if (cellDrill.columnKey === "intoBracket") {
      return buildBracketStackCellDrill({ year: cellDrill.year, columnKey: cellDrill.columnKey, ctx });
    }
    return buildConversionCellDrill({ year: cellDrill.year, columnKey: cellDrill.columnKey, ctx });
  }, [cellDrill, ctx]);

  return (
    <>
      <DialogShell
        open={true}
        onOpenChange={(open) => { if (!open) onClose(); }}
        title="Tax Detail — All Years"
        size="xl"
        tabs={TAX_DETAIL_TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TaxDetailTabId)}
        secondaryAction={{ label: "Close", onClick: onClose }}
      >
        <TaxDetailView
          activeTab={activeTab}
          years={years}
          onYearClick={onYearClick}
          onIncomeCellClick={(year, columnKey) =>
            setCellDrill({ source: "income", year, columnKey })}
          onBracketCellClick={(yr, columnKey) => {
            const year = years.find((y) => y.year === yr);
            if (year) setCellDrill({ source: "bracket", year, columnKey });
          }}
          yearRange={yearRange}
          onYearRangeChange={onYearRangeChange}
          planStartYear={planStartYear}
          planEndYear={planEndYear}
          clientRetirementYear={clientRetirementYear}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      </DialogShell>

      {drillProps && (
        <TaxCellDrillDownModal {...drillProps} onClose={() => setCellDrill(null)} />
      )}
    </>
  );
}
