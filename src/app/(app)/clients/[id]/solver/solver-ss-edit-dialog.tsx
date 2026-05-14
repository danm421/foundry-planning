"use client";

import { useMemo, useState } from "react";
import type { ClientData, Income } from "@/engine/types";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  inputBaseClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type {
  SolverMutation,
  SolverPerson,
  SsBenefitMode,
  SsClaimAgeMode,
} from "@/lib/solver/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onEmit: (mutations: SolverMutation[]) => void;
  person: SolverPerson;
  client: ClientData["client"];
  workingRow: Income;
}

export function SolverSsEditDialog({
  open,
  onClose,
  onEmit,
  person,
  client,
  workingRow,
}: Props) {
  const firstName =
    person === "spouse" ? (client.spouseName ?? "Spouse") : client.firstName;
  const ownerDob = person === "spouse" ? client.spouseDob : client.dateOfBirth;
  const ownerRetirementAge =
    person === "spouse" ? client.spouseRetirementAge : client.retirementAge;

  const [benefitMode, setBenefitMode] = useState<SsBenefitMode>(
    workingRow.ssBenefitMode ?? "manual_amount",
  );
  const [piaMonthly, setPiaMonthly] = useState<string>(
    workingRow.piaMonthly != null ? String(workingRow.piaMonthly) : "",
  );
  const [annualAmount, setAnnualAmount] = useState<string>(
    workingRow.annualAmount != null ? String(workingRow.annualAmount) : "",
  );
  const [claimingAgeMode, setClaimingAgeMode] = useState<SsClaimAgeMode>(
    workingRow.claimingAgeMode ?? "years",
  );
  const [claimingAge, setClaimingAge] = useState<number>(
    workingRow.claimingAge ?? 67,
  );
  const [claimingAgeMonths, setClaimingAgeMonths] = useState<number>(
    workingRow.claimingAgeMonths ?? 0,
  );
  const [colaPct, setColaPct] = useState<string>(
    String(((workingRow.growthRate ?? 0.02) * 100).toFixed(2).replace(/\.?0+$/, "")),
  );

  const currentYear = new Date().getFullYear();

  const fraDisplay = useMemo(() => {
    if (!ownerDob) return null;
    const fra = fraForBirthDate(ownerDob);
    return `Full Retirement Age: ${fra.years}y ${fra.months}mo (born ${ownerDob.slice(0, 4)})`;
  }, [ownerDob]);

  const preview = useMemo(() => {
    if (benefitMode === "no_benefit") return null;
    if (benefitMode === "manual_amount") {
      const amount = parseFloat(annualAmount);
      if (isNaN(amount) || amount <= 0) return null;
      return Math.round(amount);
    }
    const pia = parseFloat(piaMonthly);
    if (isNaN(pia) || pia <= 0 || !ownerDob) return null;
    const mockRow: Income = {
      id: "preview",
      type: "social_security",
      name: "",
      annualAmount: 0,
      startYear: currentYear,
      endYear: 2099,
      growthRate: 0,
      owner: person,
      claimingAge,
      claimingAgeMonths,
      claimingAgeMode,
      piaMonthly: pia,
      ssBenefitMode: "pia_at_fra",
    };
    const claimAgeMonthsResolved = resolveClaimAgeMonths(mockRow, client);
    if (claimAgeMonthsResolved == null) return null;
    const monthly = computeOwnMonthlyBenefit({
      piaMonthly: pia,
      claimAgeMonths: claimAgeMonthsResolved,
      dob: ownerDob,
    });
    return Math.round(monthly * 12);
  }, [
    benefitMode,
    piaMonthly,
    annualAmount,
    claimingAge,
    claimingAgeMonths,
    claimingAgeMode,
    ownerDob,
    person,
    client,
    currentYear,
  ]);

  function handleApply() {
    const out: SolverMutation[] = [];

    if (benefitMode !== (workingRow.ssBenefitMode ?? "manual_amount")) {
      out.push({ kind: "ss-benefit-mode", person, mode: benefitMode });
    }
    if (benefitMode === "pia_at_fra") {
      const pia = parseFloat(piaMonthly);
      if (!isNaN(pia) && pia !== (workingRow.piaMonthly ?? null)) {
        out.push({ kind: "ss-pia-monthly", person, amount: pia });
      }
    } else if (benefitMode === "manual_amount") {
      const amt = parseFloat(annualAmount);
      if (!isNaN(amt) && amt !== workingRow.annualAmount) {
        out.push({ kind: "ss-annual-amount", person, amount: amt });
      }
    }
    if (claimingAgeMode !== (workingRow.claimingAgeMode ?? "years")) {
      out.push({ kind: "ss-claim-age-mode", person, mode: claimingAgeMode });
    }
    if (claimingAgeMode === "years") {
      const ageChanged = claimingAge !== (workingRow.claimingAge ?? 67);
      const monthsChanged =
        claimingAgeMonths !== (workingRow.claimingAgeMonths ?? 0);
      if (ageChanged || monthsChanged) {
        out.push({
          kind: "ss-claim-age",
          person,
          age: claimingAge,
          months: claimingAgeMonths,
        });
      }
    }
    const colaRate = parseFloat(colaPct) / 100;
    if (!isNaN(colaRate) && colaRate !== workingRow.growthRate) {
      out.push({ kind: "ss-cola", person, rate: colaRate });
    }

    if (out.length > 0) onEmit(out);
    onClose();
  }

  const fraDisabled = !ownerDob;
  const retirementDisabled = ownerRetirementAge == null;

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`${firstName}'s Social Security`}
      size="md"
      primaryAction={{ label: "Apply", onClick: handleApply }}
    >
      {fraDisplay && (
        <p className="text-[12px] text-ink-3 mb-4">{fraDisplay}</p>
      )}

      <fieldset className="mb-4">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Benefit mode
        </legend>
        <label className="block text-[14px] text-ink-2 mb-1">
          <input
            type="radio"
            checked={benefitMode === "pia_at_fra"}
            onChange={() => setBenefitMode("pia_at_fra")}
            className="mr-2"
          />
          Primary Insurance Amount (PIA)
        </label>
        <label className="block text-[14px] text-ink-2 mb-1">
          <input
            type="radio"
            checked={benefitMode === "manual_amount"}
            onChange={() => setBenefitMode("manual_amount")}
            className="mr-2"
          />
          Annual benefit amount
        </label>
        <label className="block text-[14px] text-ink-2 mb-1">
          <input
            type="radio"
            checked={benefitMode === "no_benefit"}
            onChange={() => setBenefitMode("no_benefit")}
            className="mr-2"
          />
          No Benefit
        </label>
      </fieldset>

      {benefitMode === "pia_at_fra" && (
        <div className="mb-4">
          <label className={fieldLabelClassName}>Monthly PIA</label>
          <input
            type="number"
            value={piaMonthly}
            onChange={(e) => setPiaMonthly(e.target.value)}
            placeholder="e.g. 2800"
            className={inputClassName}
          />
          <p className="text-[12px] text-ink-3 mt-1">
            From your SSA statement — monthly benefit at FRA.
          </p>
        </div>
      )}
      {benefitMode === "manual_amount" && (
        <div className="mb-4">
          <label className={fieldLabelClassName}>Annual benefit amount</label>
          <input
            type="number"
            value={annualAmount}
            onChange={(e) => setAnnualAmount(e.target.value)}
            className={inputClassName}
          />
        </div>
      )}
      {benefitMode === "no_benefit" && (
        <p className="text-[14px] text-ink-3 italic mb-4">
          This person will receive no Social Security benefit in the projection.
        </p>
      )}

      {benefitMode !== "no_benefit" && (
        <fieldset className="mb-4">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Claim age
          </legend>
          <label
            className="block text-[14px] text-ink-2 mb-1"
            title={fraDisabled ? "Set date of birth to use FRA" : undefined}
          >
            <input
              type="radio"
              disabled={fraDisabled}
              checked={claimingAgeMode === "fra"}
              onChange={() => setClaimingAgeMode("fra")}
              className="mr-2"
            />
            Full Retirement Age
          </label>
          <label
            className="block text-[14px] text-ink-2 mb-1"
            title={
              retirementDisabled
                ? "Set retirement age to use this option"
                : undefined
            }
          >
            <input
              type="radio"
              disabled={retirementDisabled}
              checked={claimingAgeMode === "at_retirement"}
              onChange={() => setClaimingAgeMode("at_retirement")}
              className="mr-2"
            />
            At Retirement
            {ownerRetirementAge != null ? ` (${ownerRetirementAge})` : ""}
          </label>
          <label className="block text-[14px] text-ink-2 mb-1">
            <input
              type="radio"
              checked={claimingAgeMode === "years"}
              onChange={() => setClaimingAgeMode("years")}
              className="mr-2"
            />
            Specific Age
          </label>
          {claimingAgeMode === "years" && (
            <div className="flex gap-2 mt-2 ml-6">
              <select
                value={claimingAge}
                onChange={(e) => setClaimingAge(parseInt(e.target.value, 10))}
                className={selectClassName}
              >
                {[62, 63, 64, 65, 66, 67, 68, 69, 70].map((y) => (
                  <option key={y} value={y}>
                    {y} years
                  </option>
                ))}
              </select>
              <select
                value={claimingAgeMonths}
                onChange={(e) =>
                  setClaimingAgeMonths(parseInt(e.target.value, 10))
                }
                className={selectClassName}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {i} months
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>
      )}

      {benefitMode !== "no_benefit" && (
        <div className="mb-4">
          <label className={fieldLabelClassName}>Annual COLA %</label>
          <input
            type="number"
            step="0.5"
            value={colaPct}
            onChange={(e) => setColaPct(e.target.value)}
            className={inputBaseClassName + " w-32"}
          />
        </div>
      )}

      {preview != null && (
        <p className="text-[14px] text-ink-2 mb-4">
          Estimated first-year benefit: ${preview.toLocaleString()}
        </p>
      )}
    </DialogShell>
  );
}
