// src/components/quick-start/assumptions-step.tsx
"use client";
import { useState } from "react";
import { inputClassName } from "@/components/forms/input-styles";
import { planSettingsPayload } from "@/lib/quick-start/derive";
import type { QsAssumptionsDraft, QsTaxMode } from "@/lib/quick-start/types";
import type { USPSStateCode } from "@/lib/usps-states";
import type { QsStepProps } from "./step-props";
import { Labeled, sendJson } from "./ui";
import {
  GrowthRateRows,
  type InvestableRow,
  type InvestableKey,
  type FlatRow,
  type FlatKey,
} from "./growth-rate-rows";

/** Convert a fraction to a clean percent display string (avoids floating-point noise). */
function toDisplayPct(fraction: number): string {
  return String(Math.round(fraction * 10000) / 100);
}

export function AssumptionsStep({ bootstrap, registerSave }: QsStepProps) {
  const dg = bootstrap.defaultGrowth;
  const gs = bootstrap.growthSource;

  const [taxMode, setTaxMode] = useState<QsTaxMode>("brackets");
  const [flatFedDisplay, setFlatFedDisplay] = useState("22");
  const [flatStateDisplay, setFlatStateDisplay] = useState("5");
  const [inflationDisplay, setInflationDisplay] = useState(toDisplayPct(dg.inflation));

  const [investable, setInvestable] = useState<Record<InvestableKey, InvestableRow>>({
    taxable: { ...gs.taxable, customDisplay: toDisplayPct(dg.taxable) },
    cash: { ...gs.cash, customDisplay: toDisplayPct(dg.cash) },
    retirement: { ...gs.retirement, customDisplay: toDisplayPct(dg.retirement) },
  });
  const [flat, setFlat] = useState<Record<FlatKey, FlatRow>>({
    realEstate: { source: gs.realEstate, customDisplay: toDisplayPct(dg.realEstate) },
    lifeInsurance: { source: gs.lifeInsurance, customDisplay: toDisplayPct(dg.lifeInsurance) },
  });

  const onInvestableChange = (key: InvestableKey, next: InvestableRow) =>
    setInvestable((prev) => ({ ...prev, [key]: next }));
  const onFlatChange = (key: FlatKey, next: FlatRow) =>
    setFlat((prev) => ({ ...prev, [key]: next }));

  registerSave(async () => {
    const draft: QsAssumptionsDraft = {
      taxMode,
      flatFederalRate: taxMode === "flat" ? Number(flatFedDisplay) / 100 : undefined,
      flatStateRate: taxMode === "flat" ? Number(flatStateDisplay) / 100 : undefined,
      inflationRate: Number(inflationDisplay) / 100,
      growthTaxable: Number(investable.taxable.customDisplay) / 100,
      growthCash: Number(investable.cash.customDisplay) / 100,
      growthRetirement: Number(investable.retirement.customDisplay) / 100,
      growthRealEstate: Number(flat.realEstate.customDisplay) / 100,
      growthLifeInsurance: Number(flat.lifeInsurance.customDisplay) / 100,
      growthSourceTaxable: investable.taxable.source,
      growthSourceCash: investable.cash.source,
      growthSourceRetirement: investable.retirement.source,
      modelPortfolioIdTaxable: investable.taxable.portfolioId,
      modelPortfolioIdCash: investable.cash.portfolioId,
      modelPortfolioIdRetirement: investable.retirement.portfolioId,
      growthSourceRealEstate: flat.realEstate.source,
      growthSourceLifeInsurance: flat.lifeInsurance.source,
    };
    await sendJson(
      `/api/clients/${bootstrap.clientId}/plan-settings`,
      "PUT",
      planSettingsPayload(draft, bootstrap.residenceState as USPSStateCode | null),
    );
  });

  return (
    <div className="space-y-6">
      {/* Tax mode */}
      <div>
        <div className="mb-2 text-[12px] font-medium text-ink-3">Tax mode</div>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input
              type="radio"
              aria-label="Use tax brackets"
              name="taxMode"
              value="brackets"
              checked={taxMode === "brackets"}
              onChange={() => setTaxMode("brackets")}
            />
            Use tax brackets
          </label>
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input
              type="radio"
              aria-label="Use flat rates"
              name="taxMode"
              value="flat"
              checked={taxMode === "flat"}
              onChange={() => setTaxMode("flat")}
            />
            Use flat rates
          </label>
        </div>
      </div>

      {/* Flat-rate inputs (revealed only in flat mode) */}
      {taxMode === "flat" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Federal rate (%)">
            <input
              type="number"
              aria-label="Federal rate"
              value={flatFedDisplay}
              onChange={(e) => setFlatFedDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="State rate (%)">
            <input
              type="number"
              aria-label="State rate"
              value={flatStateDisplay}
              onChange={(e) => setFlatStateDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
        </div>
      )}

      {/* Inflation */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label="Inflation (%)">
          <input
            type="number"
            aria-label="Inflation rate"
            value={inflationDisplay}
            onChange={(e) => setInflationDisplay(e.target.value)}
            className={inputClassName}
          />
        </Labeled>
      </div>

      {/* Growth rates — source picker per category */}
      <GrowthRateRows
        modelPortfolios={bootstrap.modelPortfolios}
        inflationPct={Number(inflationDisplay) || 0}
        investable={investable}
        flat={flat}
        onInvestableChange={onInvestableChange}
        onFlatChange={onFlatChange}
      />
    </div>
  );
}
