"use client";

import { useMemo, useState } from "react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";

type SsBenefitMode = "pia_at_fra" | "manual_amount" | "no_benefit";
type ClaimAgeMode = "fra" | "at_retirement" | "years";

export interface SocialSecurityDialogProps {
  clientId: string;
  owner: "client" | "spouse";
  existingRow: Income | null;
  clientInfo: ClientInfo;
  planSettings: PlanSettings;
  onClose: () => void;
  onSaved: () => void;  // parent re-fetches or re-renders
}

export function SocialSecurityDialog({
  clientId,
  owner,
  existingRow,
  clientInfo,
  planSettings,
  onClose,
  onSaved,
}: SocialSecurityDialogProps) {
  const firstName = owner === "spouse"
    ? (clientInfo.spouseName ?? "Spouse")
    : clientInfo.firstName;

  const ownerDob = owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
  const ownerRetirementAge = owner === "spouse" ? clientInfo.spouseRetirementAge : clientInfo.retirementAge;

  const currentYear = new Date().getFullYear();

  // ── State ────────────────────────────────────────────────
  const [ssBenefitMode, setSsBenefitMode] = useState<SsBenefitMode>(() => {
    const stored = existingRow?.ssBenefitMode;
    if (stored === "pia_at_fra" || stored === "manual_amount" || stored === "no_benefit") return stored;
    return existingRow ? "manual_amount" : "pia_at_fra";
  });

  const [piaMonthly, setPiaMonthly] = useState<string>(
    existingRow?.piaMonthly != null ? String(existingRow.piaMonthly) : ""
  );

  const [annualAmount, setAnnualAmount] = useState<string>(
    existingRow?.annualAmount != null ? String(existingRow.annualAmount) : ""
  );

  const [claimingAgeMode, setClaimingAgeMode] = useState<ClaimAgeMode>(() => {
    const stored = existingRow?.claimingAgeMode;
    if (stored === "years" || stored === "fra" || stored === "at_retirement") return stored;
    return existingRow ? "years" : "fra";
  });

  const [claimingAge, setClaimingAge] = useState<number>(existingRow?.claimingAge ?? 67);
  const [claimingAgeMonths, setClaimingAgeMonths] = useState<number>(existingRow?.claimingAgeMonths ?? 0);

  const [growthRate, setGrowthRate] = useState<string>(() => {
    if (existingRow?.growthRate != null) return String(existingRow.growthRate * 100);
    return String(planSettings.inflationRate * 100);
  });

  // ── Derived display ──────────────────────────────────────
  const fraDisplay = useMemo(() => {
    if (!ownerDob) return null;
    const fra = fraForBirthDate(ownerDob);
    return `Full Retirement Age: ${fra.years}y ${fra.months}mo (born ${ownerDob.slice(0, 4)})`;
  }, [ownerDob]);

  const preview = useMemo(() => {
    if (ssBenefitMode === "no_benefit") return null;
    const growthPct = parseFloat(growthRate) / 100 || 0;

    if (ssBenefitMode === "manual_amount") {
      const amount = parseFloat(annualAmount);
      if (isNaN(amount) || amount <= 0) return null;
      return Math.round(amount * Math.pow(1 + growthPct, 0));
    }

    // pia_at_fra
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
      owner,
      claimingAge,
      claimingAgeMonths,
      claimingAgeMode,
      piaMonthly: pia,
      ssBenefitMode: "pia_at_fra",
    };
    const claimAgeMonthsResolved = resolveClaimAgeMonths(mockRow, clientInfo);
    if (claimAgeMonthsResolved == null) return null;

    const monthly = computeOwnMonthlyBenefit({
      piaMonthly: pia,
      claimAgeMonths: claimAgeMonthsResolved,
      dob: ownerDob,
    });
    return Math.round(monthly * 12);
  }, [ssBenefitMode, piaMonthly, annualAmount, growthRate, claimingAge, claimingAgeMonths, claimingAgeMode, ownerDob, owner, clientInfo, currentYear]);

  // ── Save ─────────────────────────────────────────────────
  async function handleSave() {
    const growthPct = parseFloat(growthRate) / 100 || 0;
    const pia = ssBenefitMode === "pia_at_fra" ? parseFloat(piaMonthly) || 0 : null;
    const annual = ssBenefitMode === "manual_amount"
      ? (parseFloat(annualAmount) || 0)
      : (existingRow?.annualAmount ?? 0);   // preserve or zero

    const payload = {
      type: "social_security",
      owner,
      name: existingRow?.name ?? `${firstName}'s Social Security`,
      annualAmount: annual,
      startYear: existingRow?.startYear ?? currentYear,
      endYear: existingRow?.endYear ?? 2099,
      growthRate: growthPct,
      inflationStartYear: existingRow?.inflationStartYear ?? currentYear,
      claimingAge: claimingAgeMode === "years" ? claimingAge : (existingRow?.claimingAge ?? claimingAge),
      claimingAgeMonths: claimingAgeMode === "years" ? claimingAgeMonths : (existingRow?.claimingAgeMonths ?? 0),
      claimingAgeMode,
      ssBenefitMode,
      piaMonthly: pia,
    };

    const url = existingRow
      ? `/api/clients/${clientId}/incomes/${existingRow.id}`
      : `/api/clients/${clientId}/incomes`;
    const method = existingRow ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      alert(`Save failed: ${text}`);
      return;
    }
    onSaved();
    onClose();
  }

  const fraDisabled = !ownerDob;
  const retirementDisabled = ownerRetirementAge == null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Edit {firstName}&apos;s Social Security</h2>

        {fraDisplay && (
          <p className="text-xs text-slate-500 mb-4">{fraDisplay}</p>
        )}

        {/* Benefit mode */}
        <fieldset className="mb-4">
          <legend className="text-sm font-medium mb-2">Benefit mode</legend>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "pia_at_fra"} onChange={() => setSsBenefitMode("pia_at_fra")} className="mr-2" />
            Primary Insurance Amount (PIA)
          </label>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "manual_amount"} onChange={() => setSsBenefitMode("manual_amount")} className="mr-2" />
            Annual benefit amount
          </label>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "no_benefit"} onChange={() => setSsBenefitMode("no_benefit")} className="mr-2" />
            No Benefit
          </label>
        </fieldset>

        {/* Conditional amount input */}
        {ssBenefitMode === "pia_at_fra" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Monthly PIA</label>
            <input
              type="number"
              value={piaMonthly}
              onChange={(e) => setPiaMonthly(e.target.value)}
              placeholder="e.g. 2800"
              className="w-full border rounded px-2 py-1"
            />
            <p className="text-xs text-slate-500 mt-1">From your SSA statement — monthly benefit at FRA.</p>
          </div>
        )}
        {ssBenefitMode === "manual_amount" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Annual benefit amount</label>
            <input
              type="number"
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              className="w-full border rounded px-2 py-1"
            />
          </div>
        )}
        {ssBenefitMode === "no_benefit" && (
          <p className="text-sm text-slate-500 italic mb-4">
            This person will receive no Social Security benefit in the projection.
          </p>
        )}

        {/* Claim age mode */}
        {ssBenefitMode !== "no_benefit" && (
          <fieldset className="mb-4">
            <legend className="text-sm font-medium mb-2">Claim age</legend>
            <label className="block text-sm mb-1" title={fraDisabled ? "Set date of birth to use FRA" : undefined}>
              <input
                type="radio"
                disabled={fraDisabled}
                checked={claimingAgeMode === "fra"}
                onChange={() => setClaimingAgeMode("fra")}
                className="mr-2"
              />
              Full Retirement Age
            </label>
            <label className="block text-sm mb-1" title={retirementDisabled ? "Set retirement age to use this option" : undefined}>
              <input
                type="radio"
                disabled={retirementDisabled}
                checked={claimingAgeMode === "at_retirement"}
                onChange={() => setClaimingAgeMode("at_retirement")}
                className="mr-2"
              />
              At Retirement{ownerRetirementAge != null ? ` (${ownerRetirementAge})` : ""}
            </label>
            <label className="block text-sm mb-1">
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
                  className="border rounded px-2 py-1"
                >
                  {[62, 63, 64, 65, 66, 67, 68, 69, 70].map((y) => (
                    <option key={y} value={y}>{y} years</option>
                  ))}
                </select>
                <select
                  value={claimingAgeMonths}
                  onChange={(e) => setClaimingAgeMonths(parseInt(e.target.value, 10))}
                  className="border rounded px-2 py-1"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>{i} months</option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
        )}

        {/* COLA */}
        {ssBenefitMode !== "no_benefit" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Annual COLA %</label>
            <input
              type="number"
              step="0.1"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
              className="w-32 border rounded px-2 py-1"
            />
          </div>
        )}

        {/* Preview */}
        {preview != null && (
          <p className="text-sm text-slate-600 mb-4">
            Estimated first-year benefit: ${preview.toLocaleString()}
          </p>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 border rounded">Cancel</button>
          <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white rounded">Save</button>
        </div>
      </div>
    </div>
  );
}
