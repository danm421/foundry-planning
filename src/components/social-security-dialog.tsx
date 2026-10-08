"use client";

import { useEffect, useMemo, useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import type { Income, ClientInfo, PlanSettings, MedicareCoverage } from "@/engine/types";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import { personLabel } from "@/lib/owner-labels";
import {
  estimatePiaFromSalary,
  ownerAnnualSalary,
  FULL_CAREER_YEARS,
  type SalaryLike,
} from "@/lib/social-security/estimate-from-salary";
import {
  ageLabel,
  convertAmountText,
  entryUnit,
  initialEntryAmount,
  initialStatedAge,
  otherSsRow,
  ssEntryPreview,
  toAnnual,
  toMonthly,
  type SsAmountUnit,
  type SsRowLike,
} from "@/lib/social-security/benefit-entry";
import DialogShell from "./dialog-shell";
import { inputBaseClassName, selectClassName, fieldLabelClassName } from "./forms/input-styles";
import { SocialSecurityAmountFields } from "./social-security-amount-fields";
import { MedicareDialogTab } from "./medicare/medicare-dialog-tab";

type SsBenefitMode = "pia_at_fra" | "manual_amount" | "no_benefit";
type ClaimAgeMode = "fra" | "at_retirement" | "years";

/** UI-only choice: "estimate_from_salary" fills the PIA box and saves as
 *  `pia_at_fra`, so no reader has to learn a fourth stored mode. */
type BenefitChoice = SsBenefitMode | "estimate_from_salary";

export interface SocialSecurityDialogProps {
  clientId: string;
  owner: "client" | "spouse";
  existingRow: Income | null;
  clientInfo: ClientInfo;
  planSettings: PlanSettings;
  /**
   * The household's income rows, read only to estimate a PIA off the owner's
   * salary. Passed in rather than fetched because a base-scoped list-GET would
   * estimate off the base salary while a scenario is active — the rule
   * `map-content.tsx` states for every client-side editor.
   */
  incomes: readonly (SalaryLike & Partial<SsRowLike>)[];
  onClose: () => void;
  onSaved: () => void;  // parent re-fetches or re-renders
}

export function SocialSecurityDialog({
  clientId,
  owner,
  existingRow,
  clientInfo,
  planSettings,
  incomes,
  onClose,
  onSaved,
}: SocialSecurityDialogProps) {
  const firstName = personLabel(owner, { clientName: clientInfo.firstName, spouseName: clientInfo.spouseName ?? null });

  const ownerDob = owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
  const ownerRetirementAge = owner === "spouse" ? clientInfo.spouseRetirementAge : clientInfo.retirementAge;

  const currentYear = new Date().getFullYear();

  // ── State ────────────────────────────────────────────────
  // No stored PIA means the row was never configured — `create-client` seeds
  // every new household that way, which is what makes the estimate their
  // default. A stored amount always wins; never overwrite an SSA figure.
  const [openingMode] = useState<BenefitChoice>(() => {
    const stored = existingRow?.ssBenefitMode;
    if (stored === "manual_amount" || stored === "no_benefit") return stored;
    const hasPia = existingRow?.piaMonthly != null && Number(existingRow.piaMonthly) > 0;
    return hasPia ? "pia_at_fra" : "estimate_from_salary";
  });
  const [ssBenefitMode, setSsBenefitMode] = useState<BenefitChoice>(openingMode);

  const usesPia = ssBenefitMode === "pia_at_fra" || ssBenefitMode === "estimate_from_salary";

  // One amount box and one unit for every mode; the unit is display only and
  // storage stays canonical (PIA monthly, stated benefit annual) at save.
  const [amount, setAmount] = useState<string>(() => initialEntryAmount(existingRow));
  const [unit, setUnit] = useState<SsAmountUnit>(() =>
    // A stored unit wins; otherwise the unit follows the mode the dialog opens in.
    entryUnit({
      ssBenefitMode: openingMode === "estimate_from_salary" ? "pia_at_fra" : openingMode,
      ssAmountUnit: existingRow?.ssAmountUnit,
    }),
  );
  const [statedAge, setStatedAge] = useState(() => initialStatedAge(existingRow, clientInfo));

  const [claimingAgeMode, setClaimingAgeMode] = useState<ClaimAgeMode>(() => {
    const stored = existingRow?.claimingAgeMode;
    if (stored === "years" || stored === "fra" || stored === "at_retirement") return stored;
    return existingRow ? "years" : "fra";
  });

  const [claimingAge, setClaimingAge] = useState<number>(existingRow?.claimingAge ?? 67);
  const [claimingAgeMonths, setClaimingAgeMonths] = useState<number>(existingRow?.claimingAgeMonths ?? 0);

  const [growthRate, setGrowthRate] = useState<string>(() => {
    if (existingRow?.growthRate != null) return String(existingRow.growthRate * 100);
    return "2";
  });

  const writer = useScenarioWriter(clientId);

  const [activeTab, setActiveTab] = useState<"ss" | "medicare">("ss");
  const [existingMedicare, setExistingMedicare] = useState<MedicareCoverage | null>(null);
  useEffect(() => {
    fetch(`/api/clients/${clientId}/medicare-coverage`)
      .then(r => r.ok ? r.json() : [])
      .then((all: MedicareCoverage[]) => {
        setExistingMedicare(all.find(c => c.owner === owner) ?? null);
      })
      .catch(() => {});
  }, [clientId, owner]);

  // ── Salary-derived PIA estimate ──────────────────────────
  const ownerSalary = useMemo(
    () => ownerAnnualSalary(incomes, owner, currentYear),
    [incomes, owner, currentYear],
  );
  const estimateText = ownerSalary > 0 ? String(estimatePiaFromSalary(ownerSalary)) : "";
  /** Derived under the estimate (monthly-native); the PIA radio commits it into `amount`. */
  const piaFieldValue =
    ssBenefitMode === "estimate_from_salary" ? convertAmountText(estimateText, "monthly", unit) : amount;

  // ── Derived display ──────────────────────────────────────
  const fraDisplay = useMemo(() => {
    if (!ownerDob) return null;
    const fra = fraForBirthDate(ownerDob);
    return `Full Retirement Age: ${fra.years}y ${fra.months}mo (born ${ownerDob.slice(0, 4)})`;
  }, [ownerDob]);

  const draftRow: Income = useMemo(() => {
    const typed = parseFloat(piaFieldValue);
    const isStated = ssBenefitMode === "manual_amount";
    return {
      id: existingRow?.id ?? "draft", type: "social_security", name: "",
      annualAmount: isStated && !isNaN(typed) ? toAnnual(typed, unit) : 0,
      startYear: currentYear, endYear: 2099, growthRate: 0, owner,
      claimingAge, claimingAgeMonths, claimingAgeMode,
      ssBenefitMode: ssBenefitMode === "estimate_from_salary" ? "pia_at_fra" : ssBenefitMode,
      piaMonthly: !isStated && !isNaN(typed) ? toMonthly(typed, unit) : undefined,
      ssStatedAge: isStated ? statedAge.years : null,
      ssStatedAgeMonths: isStated ? statedAge.months : null,
    };
  }, [piaFieldValue, unit, ssBenefitMode, statedAge, claimingAge, claimingAgeMonths, claimingAgeMode, owner, currentYear, existingRow?.id]);

  const preview = useMemo(
    () => (ssBenefitMode === "no_benefit" ? null : ssEntryPreview(draftRow, otherSsRow(incomes, owner), clientInfo)),
    [draftRow, incomes, owner, clientInfo, ssBenefitMode],
  );
  const claimMonths = resolveClaimAgeMonths(draftRow, clientInfo);
  const claimLabel = claimMonths != null ? ageLabel(Math.floor(claimMonths / 12), claimMonths % 12) : "the claim age";
  const nameFor = (who: "client" | "spouse") =>
    personLabel(who, { clientName: clientInfo.firstName, spouseName: clientInfo.spouseName ?? null });

  /** The claim age follows the stated age only while the two match. */
  function changeStatedAge(next: { years: number; months: number }) {
    const tracking =
      claimingAgeMode === "years" && claimingAge === statedAge.years && claimingAgeMonths === statedAge.months;
    setStatedAge(next);
    if (tracking) {
      setClaimingAge(next.years);
      setClaimingAgeMonths(next.months);
    }
  }

  // ── Save ─────────────────────────────────────────────────
  async function handleSave() {
    const growthPct = parseFloat(growthRate) / 100 || 0;
    const typed = parseFloat(piaFieldValue);
    const stated = ssBenefitMode === "manual_amount";
    const cents = (x: number) => Math.round(x * 100) / 100;
    const annual = stated ? (isNaN(typed) ? 0 : cents(toAnnual(typed, unit))) : (existingRow?.annualAmount ?? 0);
    const pia = usesPia ? (isNaN(typed) ? 0 : cents(toMonthly(typed, unit))) : null;

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
      ssBenefitMode: ssBenefitMode === "estimate_from_salary" ? "pia_at_fra" : ssBenefitMode,
      piaMonthly: pia,
      ssStatedAge: stated ? statedAge.years : null,
      ssStatedAgeMonths: stated ? statedAge.months : null,
      ssAmountUnit: ssBenefitMode === "no_benefit" ? (existingRow?.ssAmountUnit ?? null) : unit,
    };

    const url = existingRow
      ? `/api/clients/${clientId}/incomes/${existingRow.id}`
      : `/api/clients/${clientId}/incomes`;
    const method = existingRow ? "PUT" : "POST";

    // Route through useScenarioWriter so that when ?scenario= is set the write
    // records a scenario_change rather than mutating the base income row. In
    // base mode the hook passes the baseFallback through unchanged.
    const res = existingRow
      ? await writer.submit(
          { op: "edit", targetKind: "income", targetId: existingRow.id, desiredFields: payload },
          { url, method, body: payload },
        )
      : await writer.submit(
          { op: "add", targetKind: "income", entity: { id: crypto.randomUUID(), ...payload } },
          { url, method, body: payload },
        );

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
    <DialogShell
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Edit ${firstName}'s Social Security`}
      size="md"
      tabs={[
        { id: "ss", label: "Social Security" },
        { id: "medicare", label: "Medicare" },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as "ss" | "medicare")}
      primaryAction={activeTab === "ss" ? { label: "Save", onClick: handleSave } : undefined}
    >
      {activeTab === "ss" && (
        <div>
          {fraDisplay && (
            <p className="text-[12px] text-ink-3 mb-4">{fraDisplay}</p>
          )}

          {/* Benefit mode */}
          <fieldset className="mb-4">
            <legend className="text-[12px] font-medium text-ink-2 mb-2">Benefit mode</legend>
            <label className="block text-[14px] text-ink-2 mb-1">
              <input type="radio" checked={ssBenefitMode === "estimate_from_salary"} onChange={() => setSsBenefitMode("estimate_from_salary")} className="mr-2" />
              Estimate from Salary
            </label>
            <label className="block text-[14px] text-ink-2 mb-1">
              <input
                type="radio"
                checked={ssBenefitMode === "pia_at_fra"}
                onChange={() => {
                  // Hand the estimate over on the way out, so the advisor edits
                  // the figure they were just shown rather than an empty box.
                  if (ssBenefitMode === "estimate_from_salary") setAmount(convertAmountText(estimateText, "monthly", unit));
                  setSsBenefitMode("pia_at_fra");
                }}
                className="mr-2"
              />
              Primary Insurance Amount (PIA)
            </label>
            <label className="block text-[14px] text-ink-2 mb-1">
              <input
                type="radio"
                checked={ssBenefitMode === "manual_amount"}
                onChange={() => {
                  setSsBenefitMode("manual_amount");
                  setClaimingAgeMode("years");
                  setClaimingAge(statedAge.years);
                  setClaimingAgeMonths(statedAge.months);
                }}
                className="mr-2"
              />
              Benefit at a specific age
            </label>
            <label className="block text-[14px] text-ink-2 mb-1">
              <input type="radio" checked={ssBenefitMode === "no_benefit"} onChange={() => setSsBenefitMode("no_benefit")} className="mr-2" />
              No Benefit
            </label>
          </fieldset>

          {ssBenefitMode !== "no_benefit" && (
            <SocialSecurityAmountFields
              idPrefix="ss"
              label={ssBenefitMode === "manual_amount" ? "Benefit amount" : "PIA"}
              placeholder={ssBenefitMode === "manual_amount" ? "e.g. 3500" : "e.g. 2800"}
              amount={piaFieldValue}
              unit={unit}
              onChange={(next) => { setAmount(next.amount); setUnit(next.unit); }}
              readOnly={ssBenefitMode === "estimate_from_salary"}
              statedAge={ssBenefitMode === "manual_amount"
                ? { ...statedAge, dob: ownerDob, onChange: changeStatedAge }
                : undefined}
              hint={ssBenefitMode === "pia_at_fra"
                ? "From your SSA statement — monthly benefit at FRA."
                : ssBenefitMode === "estimate_from_salary"
                  ? ownerSalary > 0
                    ? `Estimated from a $${Math.round(ownerSalary).toLocaleString()} salary earned over a full ${FULL_CAREER_YEARS}-year career. Switch to PIA to enter the figure from an SSA statement.`
                    : `No salary entered for ${firstName} — add one to estimate the benefit, or switch to PIA to enter it by hand.`
                  : undefined}
            />
          )}
          {ssBenefitMode === "no_benefit" && (
            <p className="text-[14px] text-ink-3 italic mb-4">
              This person will receive no Social Security benefit in the projection.
            </p>
          )}

          {/* Claim age mode */}
          {ssBenefitMode !== "no_benefit" && (
            <fieldset className="mb-4">
              <legend className="text-[12px] font-medium text-ink-2 mb-2">Claim age</legend>
              <label className="block text-[14px] text-ink-2 mb-1" title={fraDisabled ? "Set date of birth to use FRA" : undefined}>
                <input
                  type="radio"
                  disabled={fraDisabled}
                  checked={claimingAgeMode === "fra"}
                  onChange={() => setClaimingAgeMode("fra")}
                  className="mr-2"
                />
                Full Retirement Age
              </label>
              <label className="block text-[14px] text-ink-2 mb-1" title={retirementDisabled ? "Set retirement age to use this option" : undefined}>
                <input
                  type="radio"
                  disabled={retirementDisabled}
                  checked={claimingAgeMode === "at_retirement"}
                  onChange={() => setClaimingAgeMode("at_retirement")}
                  className="mr-2"
                />
                At Retirement{ownerRetirementAge != null ? ` (${ownerRetirementAge})` : ""}
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
                    aria-label="Claim age"
                    value={claimingAge}
                    onChange={(e) => setClaimingAge(parseInt(e.target.value, 10))}
                    className={selectClassName}
                  >
                    {[62, 63, 64, 65, 66, 67, 68, 69, 70].map((y) => (
                      <option key={y} value={y}>{y} years</option>
                    ))}
                  </select>
                  <select
                    aria-label="Claim age months"
                    value={claimingAgeMonths}
                    onChange={(e) => setClaimingAgeMonths(parseInt(e.target.value, 10))}
                    className={selectClassName}
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
              <label className={fieldLabelClassName}>Annual COLA %</label>
              <input
                type="number"
                step="0.5"
                value={growthRate}
                onChange={(e) => setGrowthRate(e.target.value)}
                className={inputBaseClassName + " w-32"}
              />
            </div>
          )}

          {/* Preview */}
          {preview != null && (
            <div className="text-[14px] text-ink-2 mb-4 space-y-0.5">
              <p>
                PIA ${Math.round(preview.piaMonthly).toLocaleString()}/mo
                {preview.ownAnnual != null && ` · At ${claimLabel}: $${Math.round(preview.ownAnnual).toLocaleString()}/yr`}
              </p>
              {(["client", "spouse"] as const).map((who) => {
                const v = preview.topUps[who];
                if (v == null || v <= 0) return null;
                return <p key={who}>{nameFor(who)}&apos;s spousal top-up: ${Math.round(v).toLocaleString()}/mo</p>;
              })}
              {preview.topUps.client === 0 && preview.topUps.spouse === 0 && (
                <p className="text-ink-3">No spousal top-up — each benefit is larger than half the other&apos;s PIA.</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "medicare" && (
        <MedicareDialogTab
          clientId={clientId}
          owner={owner}
          existing={existingMedicare}
          ownerDob={ownerDob}
          scenarioActive={writer.scenarioActive}
          onSaved={() => { /* keep dialog open; parent doesn't need to know about Medicare yet */ }}
        />
      )}
    </DialogShell>
  );
}
