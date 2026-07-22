"use client";

import AssumedChip from "./assumed-chip";
import { CurrencyInput } from "@/components/currency-input";
import type {
  AssembleAssumption,
  AssemblePlanBasics,
  PlanBasicsField,
} from "@/lib/imports/assemble/types";

interface PlanBasicsStepProps {
  value: AssemblePlanBasics;
  hasSpouse: boolean;
  onChange: (next: AssemblePlanBasics) => void;
}

const INPUT_CLASS =
  "w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/** A derived field carries a chip only when it has a reason; anything else does not. */
function chipFor(field: PlanBasicsField<number>): AssembleAssumption | undefined {
  if (field.provenance !== "derived" || !field.reason) return undefined;
  return { field: "", value: field.value ?? "", reason: field.reason };
}

/** Label + Assumed chip, shared by both field flavors below. */
function FieldLabel({ id, label, field }: { id: string; label: string; field: PlanBasicsField<number> }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      {/* The chip (and its tooltip prose) must stay OUTSIDE the <label> —
          nesting it inside would fold the reason text into the label's
          accessible name, and a reason like "...full retirement age (67)..."
          can spuriously match an unrelated field's getByLabelText regex. */}
      <label htmlFor={id} className="text-xs text-gray-300">
        {label}
      </label>
      <AssumedChip assumption={chipFor(field)} />
    </div>
  );
}

/** A plain number field — for ages, not dollar amounts. */
function NumberField({
  id,
  label,
  field,
  onSet,
}: {
  id: string;
  label: string;
  field: PlanBasicsField<number>;
  onSet: (v: number | null) => void;
}) {
  return (
    <div data-field={id}>
      <FieldLabel id={id} label={label} field={field} />
      <input
        id={id}
        type="number"
        // A blank field renders empty, never 0 — 0 is a real answer.
        value={field.value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onSet(raw === "" ? null : Number(raw));
        }}
        className={INPUT_CLASS}
      />
    </div>
  );
}

/**
 * A dollar-amount field — living spending and the annual Social Security
 * benefit. Uses the
 * same CurrencyInput every other wizard step uses for money
 * (review-step-expenses.tsx's Annual Amount, review-step-incomes.tsx's
 * Annual Amount) rather than a plain number input, so it gets the $ prefix
 * and comma formatting advisors see everywhere else in the wizard.
 */
function CurrencyField({
  id,
  label,
  field,
  onSet,
}: {
  id: string;
  label: string;
  field: PlanBasicsField<number>;
  onSet: (v: number | null) => void;
}) {
  return (
    <div data-field={id}>
      <FieldLabel id={id} label={label} field={field} />
      <CurrencyInput
        id={id}
        // A blank field renders empty, never 0 — 0 is a real answer.
        value={field.value ?? ""}
        onChange={(raw) => onSet(raw === "" ? null : Number(raw))}
      />
    </div>
  );
}

/** The scalar (non-array) fields `set` below can assign to. `socialSecurity` is an array of rows, handled separately by `setSs`. */
type ScalarFieldKey = Exclude<keyof AssemblePlanBasics, "socialSecurity">;

/**
 * Plan-level values every plan needs. Unlike every other wizard tab this is
 * NOT row-driven — it renders even for an import with no extracted rows at
 * all, which is exactly the case the other tabs are built to hide.
 *
 * Any advisor edit sets provenance "stated", which clears the chip: a field
 * the advisor has touched must never keep displaying as estimated.
 */
export default function PlanBasicsStep({ value, hasSpouse, onChange }: PlanBasicsStepProps) {
  function set<K extends ScalarFieldKey>(key: K, v: number | null) {
    onChange({ ...value, [key]: { value: v, provenance: "stated" } });
  }

  function setSs(index: number, key: "pia" | "claimingAge", v: number | null) {
    const socialSecurity = value.socialSecurity.map((row, i) =>
      i === index ? { ...row, [key]: { value: v, provenance: "stated" as const } } : row,
    );
    onChange({ ...value, socialSecurity });
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Retirement horizon
        </h3>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
          <div className="grid grid-cols-4 gap-3">
            <NumberField id="retirementAge" label="Retirement age" field={value.retirementAge}
              onSet={(v) => set("retirementAge", v)} />
            <NumberField id="lifeExpectancy" label="Life expectancy" field={value.lifeExpectancy}
              onSet={(v) => set("lifeExpectancy", v)} />

            {hasSpouse && (
              <NumberField id="spouseRetirementAge" label="Spouse retirement age"
                // Absent (not just blank) on an import that predates this
                // feature — fall back to an unchipped blank field rather
                // than hiding it: blank is a valid state, absent is not.
                field={value.spouseRetirementAge ?? { value: null, provenance: "derived" }}
                onSet={(v) => set("spouseRetirementAge", v)} />
            )}
            {hasSpouse && (
              <NumberField id="spouseLifeExpectancy" label="Spouse life expectancy"
                field={value.spouseLifeExpectancy ?? { value: null, provenance: "derived" }}
                onSet={(v) => set("spouseLifeExpectancy", v)} />
            )}
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Living spending
        </h3>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
          <div className="grid grid-cols-2 gap-3">
            <CurrencyField id="currentLivingSpending" label="Current living spending"
              field={value.currentLivingSpending} onSet={(v) => set("currentLivingSpending", v)} />
            <CurrencyField id="retirementLivingSpending" label="Retirement living spending"
              field={value.retirementLivingSpending} onSet={(v) => set("retirementLivingSpending", v)} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          Social Security
        </h3>
        <div className="space-y-3">
          {value.socialSecurity.map((row, i) => (
            <div key={row.owner} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Labelled for what it actually writes: `incomes.annualAmount`
                    on a row whose `ssBenefitMode` is null, which the engine
                    reads literally as an annual benefit — no PIA/claiming-age
                    actuarial path runs. Labelling it "PIA at FRA" invited an
                    advisor to copy a MONTHLY figure off an SSA statement and
                    understate the benefit 12x. */}
                <CurrencyField id={`ss-pia-${row.owner}`}
                  label={`Annual Social Security benefit (${row.owner})`}
                  field={row.pia} onSet={(v) => setSs(i, "pia", v)} />
                <NumberField id={`ss-claim-${row.owner}`}
                  label={`Claiming age (${row.owner})`}
                  field={row.claimingAge} onSet={(v) => setSs(i, "claimingAge", v)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
