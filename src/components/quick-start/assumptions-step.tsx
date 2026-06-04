// src/components/quick-start/assumptions-step.tsx
"use client";
import { useState } from "react";
import { inputClassName } from "@/components/forms/input-styles";
import { planSettingsPayload } from "@/lib/quick-start/derive";
import type { QsAssumptionsDraft, QsTaxMode } from "@/lib/quick-start/types";
import type { USPSStateCode } from "@/lib/usps-states";
import type { QsStepProps } from "./step-props";
import { Labeled, sendJson } from "./ui";

/** Convert a fraction to a clean percent display string (avoids floating-point noise). */
function toDisplayPct(fraction: number): string {
  return String(Math.round(fraction * 10000) / 100);
}

export function AssumptionsStep({ bootstrap, registerSave }: QsStepProps) {
  const dg = bootstrap.defaultGrowth;

  const [taxMode, setTaxMode] = useState<QsTaxMode>("brackets");
  const [flatFedDisplay, setFlatFedDisplay] = useState("22");
  const [flatStateDisplay, setFlatStateDisplay] = useState("5");
  const [inflationDisplay, setInflationDisplay] = useState(toDisplayPct(dg.inflation));
  const [taxableDisplay, setTaxableDisplay] = useState(toDisplayPct(dg.taxable));
  const [cashDisplay, setCashDisplay] = useState(toDisplayPct(dg.cash));
  const [retirementDisplay, setRetirementDisplay] = useState(toDisplayPct(dg.retirement));
  const [realEstateDisplay, setRealEstateDisplay] = useState(toDisplayPct(dg.realEstate));
  const [lifeInsuranceDisplay, setLifeInsuranceDisplay] = useState(
    toDisplayPct(dg.lifeInsurance),
  );

  registerSave(async () => {
    const draft: QsAssumptionsDraft = {
      taxMode,
      flatFederalRate: taxMode === "flat" ? Number(flatFedDisplay) / 100 : undefined,
      flatStateRate: taxMode === "flat" ? Number(flatStateDisplay) / 100 : undefined,
      inflationRate: Number(inflationDisplay) / 100,
      growthTaxable: Number(taxableDisplay) / 100,
      growthCash: Number(cashDisplay) / 100,
      growthRetirement: Number(retirementDisplay) / 100,
      growthRealEstate: Number(realEstateDisplay) / 100,
      growthLifeInsurance: Number(lifeInsuranceDisplay) / 100,
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

      {/* Growth rates */}
      <div>
        <div className="mb-2 text-[12px] font-medium text-ink-3">Growth rates (%)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Taxable">
            <input
              type="number"
              aria-label="Taxable growth"
              value={taxableDisplay}
              onChange={(e) => setTaxableDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="Cash">
            <input
              type="number"
              aria-label="Cash growth"
              value={cashDisplay}
              onChange={(e) => setCashDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="Retirement">
            <input
              type="number"
              aria-label="Retirement growth"
              value={retirementDisplay}
              onChange={(e) => setRetirementDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="Real estate">
            <input
              type="number"
              aria-label="Real estate growth"
              value={realEstateDisplay}
              onChange={(e) => setRealEstateDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
          <Labeled label="Life insurance">
            <input
              type="number"
              aria-label="Life insurance growth"
              value={lifeInsuranceDisplay}
              onChange={(e) => setLifeInsuranceDisplay(e.target.value)}
              className={inputClassName}
            />
          </Labeled>
        </div>
      </div>
    </div>
  );
}
