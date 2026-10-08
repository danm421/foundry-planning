"use client";

import { useMemo, useState } from "react";
import type { ClientData, Income } from "@/engine/types";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import DialogShell from "@/components/dialog-shell";
import { SocialSecurityAmountFields } from "@/components/social-security-amount-fields";
import {
  ageLabel,
  entryUnit,
  initialEntryAmount,
  initialStatedAge,
  otherSsRow,
  ssEntryPreview,
  toAnnual,
  toMonthly,
  type SsAmountUnit,
} from "@/lib/social-security/benefit-entry";
import {
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
import { CO_CLIENT_LABEL, personLabel } from "@/lib/owner-labels";

interface Props {
  open: boolean;
  onClose: () => void;
  onEmit: (mutations: SolverMutation[]) => void;
  person: SolverPerson;
  client: ClientData["client"];
  workingRow: Income;
  /** The working household's income rows — the other spouse's SS row feeds the preview. */
  incomes: readonly Income[];
}

export function SolverSsEditDialog({
  open,
  onClose,
  onEmit,
  person,
  client,
  workingRow,
  incomes,
}: Props) {
  const firstName =
    person === "spouse" ? (client.spouseName ?? CO_CLIENT_LABEL) : client.firstName;
  const ownerDob = person === "spouse" ? client.spouseDob : client.dateOfBirth;
  const ownerRetirementAge =
    person === "spouse" ? client.spouseRetirementAge : client.retirementAge;

  const [benefitMode, setBenefitMode] = useState<SsBenefitMode>(
    workingRow.ssBenefitMode ?? "manual_amount",
  );
  // One amount box and one unit, seeded from ONE reading of the row so the
  // text always matches its label (a PIA when the row opens on one, else the
  // stated figure). The Solver does not persist the unit; it shows the row's.
  const [seed] = useState(() => {
    const seedMode = workingRow.ssBenefitMode === "pia_at_fra" ? "pia_at_fra" : "manual_amount";
    const unit = entryUnit({ ssBenefitMode: seedMode, ssAmountUnit: workingRow.ssAmountUnit });
    return {
      unit,
      amount: initialEntryAmount({ ...workingRow, ssBenefitMode: seedMode, ssAmountUnit: unit }),
    };
  });
  const [amount, setAmount] = useState<string>(seed.amount);
  const [unit, setUnit] = useState<SsAmountUnit>(seed.unit);
  const [statedAge, setStatedAge] = useState(() => initialStatedAge(workingRow, client));
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

  const draftRow: Income = useMemo(() => {
    const typed = parseFloat(amount);
    const isStated = benefitMode === "manual_amount";
    return {
      id: workingRow.id, type: "social_security", name: "",
      annualAmount: isStated && !isNaN(typed) ? toAnnual(typed, unit) : 0,
      startYear: currentYear, endYear: 2099, growthRate: 0, owner: person,
      claimingAge, claimingAgeMonths, claimingAgeMode,
      ssBenefitMode: benefitMode,
      piaMonthly: !isStated && !isNaN(typed) ? toMonthly(typed, unit) : undefined,
      ssStatedAge: isStated ? statedAge.years : null,
      ssStatedAgeMonths: isStated ? statedAge.months : null,
    };
  }, [amount, unit, benefitMode, statedAge, claimingAge, claimingAgeMonths, claimingAgeMode, person, currentYear, workingRow.id]);

  const preview = useMemo(
    () => (benefitMode === "no_benefit" ? null : ssEntryPreview(draftRow, otherSsRow(incomes, person), client)),
    [draftRow, incomes, person, client, benefitMode],
  );
  const claimMonths = resolveClaimAgeMonths(draftRow, client);
  const claimLabel = claimMonths != null ? ageLabel(Math.floor(claimMonths / 12), claimMonths % 12) : "the claim age";
  const nameFor = (who: SolverPerson) =>
    personLabel(who, { clientName: client.firstName, spouseName: client.spouseName ?? null });

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

  function handleApply() {
    const out: SolverMutation[] = [];

    if (benefitMode !== (workingRow.ssBenefitMode ?? "manual_amount")) {
      out.push({ kind: "ss-benefit-mode", person, mode: benefitMode });
    }
    const typed = parseFloat(amount);
    const cents = (x: number) => Math.round(x * 100) / 100;
    if (benefitMode === "pia_at_fra") {
      const pia = cents(toMonthly(typed, unit));
      if (!isNaN(typed) && pia !== (workingRow.piaMonthly ?? null)) {
        out.push({ kind: "ss-pia-monthly", person, amount: pia });
      }
    } else if (benefitMode === "manual_amount") {
      const annual = cents(toAnnual(typed, unit));
      if (!isNaN(typed) && annual !== workingRow.annualAmount) {
        out.push({ kind: "ss-annual-amount", person, amount: annual });
      }
      if (
        statedAge.years !== (workingRow.ssStatedAge ?? null) ||
        statedAge.months !== (workingRow.ssStatedAgeMonths ?? 0)
      ) {
        out.push({ kind: "ss-stated-age", person, age: statedAge.years, months: statedAge.months });
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
            onChange={() => {
              setBenefitMode("manual_amount");
              setClaimingAgeMode("years");
              setClaimingAge(statedAge.years);
              setClaimingAgeMonths(statedAge.months);
            }}
            className="mr-2"
          />
          Benefit at a specific age
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

      {benefitMode !== "no_benefit" && (
        <SocialSecurityAmountFields
          idPrefix="solver-ss"
          label={benefitMode === "manual_amount" ? "Benefit amount" : "PIA"}
          placeholder={benefitMode === "manual_amount" ? "e.g. 3500" : "e.g. 2800"}
          amount={amount}
          unit={unit}
          onChange={(next) => { setAmount(next.amount); setUnit(next.unit); }}
          statedAge={benefitMode === "manual_amount"
            ? { ...statedAge, dob: ownerDob, onChange: changeStatedAge }
            : undefined}
          hint={benefitMode === "pia_at_fra" ? "From your SSA statement — monthly benefit at FRA." : undefined}
        />
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
    </DialogShell>
  );
}
