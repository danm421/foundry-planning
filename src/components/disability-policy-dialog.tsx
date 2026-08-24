"use client";

/**
 * Create / edit one disability policy.
 *
 * ⚠️ THE PATCH ROUTE VALIDATES THE BODY, NOT THE MERGED ROW.
 * `disabilityPolicyUpdateSchema` is `strictPartial(...).superRefine(validateCrossFields)`,
 * and `validateCrossFields` only ever sees the keys the request carried — never
 * what is stored. That makes it wrong in both directions:
 *
 *   - `{hasShortTerm:false}` alone passes, and so does `{hasLongTerm:false}`.
 *     Two one-key saves therefore leave a policy covering NEITHER, the exact
 *     invariant a create refuses.
 *   - `{hasLongTerm:true}` with no benefit-period keys passes too, and a row
 *     whose age column is NULL then reads back as "to age 65" — an age nobody
 *     entered.
 *
 * So this dialog never sends a lone key: `disabilityPolicyBody` ships the whole
 * form on every save, and the long-term mode always travels with the value that
 * mode needs. Closing the hole properly means a read-merge-validate inside the
 * route; that is filed as shared life + disability work, not fixed here.
 *
 * The panel's inline cells are the exception, and only because the fields they
 * write (`colaRate`, `annualPremium`) appear nowhere in `validateCrossFields`.
 */

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { DisabilityCoverageTimeline } from "@/components/disability-coverage-timeline";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SwitchControl } from "@/components/forms/switch-control";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import { resolveCoverage, resolveCoveredEarnings } from "@/engine/disability-benefits";
import type { ClientInfo, DisabilityPolicy } from "@/engine/types";

/**
 * The policy as a FLAT bag of scalars — the shape the wire uses and the shape
 * `usePendingEdits` can merge (it merges by top-level key, so a nested
 * `longTerm` object could never carry an optimistic `ltdBenefitPct`).
 * Percentages are stored as DECIMALS here, exactly as the engine and the
 * column hold them; only the inputs render them as whole percents.
 */
export interface DisabilityFormValues {
  name: string;
  insured: "client" | "spouse";
  coveredEarningsMode: "salary" | "manual";
  coveredEarningsAmount: number | null;
  hasShortTerm: boolean;
  stdEliminationDays: number;
  stdBenefitPct: number;
  /** null means the advisor has cleared the field and not yet typed a new
   *  number. Never 0 — a 0 the advisor did not type reads as a real duration,
   *  and `formToPolicy` would build a short-term window paying zero weeks. */
  stdDurationWeeks: number | null;
  /** null means UNCAPPED. Never 0 — a 0 cap pays nothing. */
  stdMonthlyMax: number | null;
  hasLongTerm: boolean;
  ltdEliminationDays: number;
  ltdBenefitPct: number;
  /** null means UNCAPPED. */
  ltdMonthlyMax: number | null;
  ltdBenefitPeriodMode: "to_age" | "to_ssnra" | "years" | "lifetime";
  ltdBenefitPeriodAge: number | null;
  ltdBenefitPeriodYears: number | null;
  benefitTaxable: boolean;
  colaRate: number;
  annualPremium: number;
  premiumPayer: "employer" | "insured";
}

/** A private policy, which is typically long-term only and paid with after-tax
 *  dollars — the opposite of the workplace package the quick-add lands. */
const PRIVATE_POLICY_DEFAULTS: DisabilityFormValues = {
  name: "",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  hasShortTerm: false,
  stdEliminationDays: 7,
  stdBenefitPct: 0.6,
  stdDurationWeeks: 13,
  stdMonthlyMax: null,
  hasLongTerm: true,
  ltdEliminationDays: 90,
  ltdBenefitPct: 0.6,
  ltdMonthlyMax: null,
  ltdBenefitPeriodMode: "to_age",
  ltdBenefitPeriodAge: 65,
  ltdBenefitPeriodYears: null,
  benefitTaxable: false,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "insured",
};

export function policyToForm(p: DisabilityPolicy): DisabilityFormValues {
  const period = p.longTerm?.benefitPeriod;
  return {
    name: p.name,
    insured: p.insured,
    coveredEarningsMode: p.coveredEarningsMode,
    coveredEarningsAmount: p.coveredEarningsAmount,
    hasShortTerm: p.shortTerm !== null,
    stdEliminationDays: p.shortTerm?.eliminationDays ?? PRIVATE_POLICY_DEFAULTS.stdEliminationDays,
    stdBenefitPct: p.shortTerm?.benefitPct ?? PRIVATE_POLICY_DEFAULTS.stdBenefitPct,
    stdDurationWeeks: p.shortTerm?.durationWeeks ?? PRIVATE_POLICY_DEFAULTS.stdDurationWeeks,
    stdMonthlyMax: p.shortTerm ? p.shortTerm.monthlyMax : null,
    hasLongTerm: p.longTerm !== null,
    ltdEliminationDays: p.longTerm?.eliminationDays ?? PRIVATE_POLICY_DEFAULTS.ltdEliminationDays,
    ltdBenefitPct: p.longTerm?.benefitPct ?? PRIVATE_POLICY_DEFAULTS.ltdBenefitPct,
    ltdMonthlyMax: p.longTerm ? p.longTerm.monthlyMax : null,
    ltdBenefitPeriodMode: period?.mode ?? "to_age",
    ltdBenefitPeriodAge: period?.mode === "to_age" ? period.age : null,
    ltdBenefitPeriodYears: period?.mode === "years" ? period.years : null,
    benefitTaxable: p.benefitTaxable,
    colaRate: p.colaRate,
    annualPremium: p.annualPremium,
    premiumPayer: p.premiumPayer,
  };
}

/** The form as the engine sees it, so the timeline below the coverage sections
 *  reads the same numbers the projection will pay on. */
export function formToPolicy(f: DisabilityFormValues, id: string): DisabilityPolicy {
  // A layer whose shape is not yet complete is OMITTED, never filled in. The
  // engine has no way to say "this window is unresolved", so a fabricated
  // `?? 65` / `?? 0` reached the timeline as a real benefit window — see
  // `previewOmissions`, which puts the omission into words on screen.
  const benefitPeriod = benefitPeriodOf(f);
  return {
    id,
    name: f.name,
    insured: f.insured,
    coveredEarningsMode: f.coveredEarningsMode,
    coveredEarningsAmount: f.coveredEarningsAmount,
    shortTerm:
      f.hasShortTerm && f.stdDurationWeeks !== null
        ? {
            eliminationDays: f.stdEliminationDays,
            benefitPct: f.stdBenefitPct,
            durationWeeks: f.stdDurationWeeks,
            monthlyMax: f.stdMonthlyMax,
          }
        : null,
    longTerm:
      f.hasLongTerm && benefitPeriod !== null
        ? {
            eliminationDays: f.ltdEliminationDays,
            benefitPct: f.ltdBenefitPct,
            monthlyMax: f.ltdMonthlyMax,
            benefitPeriod,
          }
        : null,
    benefitTaxable: f.benefitTaxable,
    colaRate: f.colaRate,
    annualPremium: f.annualPremium,
    premiumPayer: f.premiumPayer,
  };
}

/** Null when the chosen mode's companion value is still blank.
 *
 *  This used to answer `{mode:"to_age", age: 65}` for an EMPTY age field, and
 *  the live timeline drew the age-65 window — switching a to-SSNRA policy to
 *  "To an age" moved the long-term band from months 3–257 to 3–233 for an age
 *  nobody had typed. The same silent fill lives in the row mapper
 *  (`load-disability-policies.ts`), which is Task 11's; this is the copy that
 *  RENDERS. "Missing values fail loudly, no silent fallback" applies to a blank
 *  age exactly as it applies to a missing date of birth. */
function benefitPeriodOf(
  f: DisabilityFormValues,
): NonNullable<DisabilityPolicy["longTerm"]>["benefitPeriod"] | null {
  switch (f.ltdBenefitPeriodMode) {
    case "to_age":
      return f.ltdBenefitPeriodAge == null ? null : { mode: "to_age", age: f.ltdBenefitPeriodAge };
    case "years":
      return f.ltdBenefitPeriodYears == null
        ? null
        : { mode: "years", years: f.ltdBenefitPeriodYears };
    case "to_ssnra":
      return { mode: "to_ssnra" };
    case "lifetime":
      return { mode: "lifetime" };
  }
}

/** Sentences for coverage blocks that are switched ON but still missing the one
 *  value their shape needs, so the advisor reads WHY a band is absent instead of
 *  wondering. `formToPolicy` drops such a block rather than inventing the value,
 *  which is what makes these sentences true. */
export function previewOmissions(f: DisabilityFormValues): string[] {
  const out: string[] = [];
  if (f.hasShortTerm && f.stdDurationWeeks === null) {
    out.push("Short-term coverage is left out below until it has a duration in weeks.");
  }
  if (f.hasLongTerm && benefitPeriodOf(f) === null) {
    out.push("Long-term coverage is left out below until its benefit period has a value.");
  }
  return out;
}

/**
 * Covered earnings for one policy, resolved the way the PROJECTION resolves
 * them. Shared by the row and by this dialog's live preview, which is why it
 * takes a policy rather than a form: both surfaces must answer identically.
 *
 * MANUAL mode is handed to the engine's own `resolveCoveredEarnings`. Its manual
 * branch reads the policy's amount plus `startYear`, `planStartYear` and
 * `inflationRate` and returns before it touches `incomes` or `client`, so the
 * browser can run it verbatim. The hand-written copy that used to sit here read
 * the RAW amount with no inflation term at all: at 3% on a plan that started two
 * years ago the engine resolved 159,135 where this screen previewed off 150,000,
 * and the error grows with the plan's age.
 *
 * SALARY mode is resolved on the SERVER, where the pre-clip income rows live —
 * `insurance-content.tsx` calls this same engine function once per person and
 * passes the two answers down as `salaryByPerson`. The income rows themselves
 * never cross the boundary.
 */
export function coveredEarningsFor(
  policy: DisabilityPolicy,
  ctx: {
    salaryByPerson: { client: number; spouse: number };
    client: ClientInfo;
    startYear: number;
    planStartYear: number;
    inflationRate: number;
  },
): number {
  if (policy.coveredEarningsMode === "salary") return ctx.salaryByPerson[policy.insured];
  return resolveCoveredEarnings(policy, {
    // MANUAL ONLY, and unread on that branch. Pinned by the panel test
    // "previews manual covered earnings exactly as the projection pays them",
    // which resolves the same policy through the engine with REAL salary rows
    // for the insured: if the manual branch ever began consulting `incomes` the
    // two figures would part and that test would red.
    incomes: [],
    client: ctx.client,
    startYear: ctx.startYear,
    planStartYear: ctx.planStartYear,
    inflationRate: ctx.inflationRate,
  });
}

/**
 * The wire body for BOTH create and update — the whole form, every time.
 *
 * The two conditional keys are the only omissions, and they are deliberate: an
 * age or a years value is sent ONLY under the mode that uses it, and never as
 * `null`. A lone `{ltdBenefitPeriodAge: null}` nulls the column and the very
 * same response then reports "to age 65", because the row mapper fills an
 * absent age with `?? 65`.
 */
export function disabilityPolicyBody(f: DisabilityFormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    insured: f.insured,
    coveredEarningsMode: f.coveredEarningsMode,
    // Travels WITH the mode, always: "manual" without an amount is a 400 even
    // when the stored row already holds one.
    coveredEarningsAmount:
      f.coveredEarningsMode === "manual" ? f.coveredEarningsAmount : null,
    // The two switches are a PAIR. Either one alone parses clean and can leave
    // the policy covering nothing.
    hasShortTerm: f.hasShortTerm,
    hasLongTerm: f.hasLongTerm,
    stdEliminationDays: f.stdEliminationDays,
    stdBenefitPct: f.stdBenefitPct,
    // Paired with the elimination days — the "duration must outlast the wait"
    // guard is skipped unless both are present.
    stdDurationWeeks: f.stdDurationWeeks,
    stdMonthlyMax: f.stdMonthlyMax,
    ltdEliminationDays: f.ltdEliminationDays,
    ltdBenefitPct: f.ltdBenefitPct,
    ltdMonthlyMax: f.ltdMonthlyMax,
    ltdBenefitPeriodMode: f.ltdBenefitPeriodMode,
    benefitTaxable: f.benefitTaxable,
    colaRate: f.colaRate,
    annualPremium: f.annualPremium,
    premiumPayer: f.premiumPayer,
  };
  if (f.ltdBenefitPeriodMode === "to_age" && f.ltdBenefitPeriodAge != null) {
    body.ltdBenefitPeriodAge = f.ltdBenefitPeriodAge;
  }
  if (f.ltdBenefitPeriodMode === "years" && f.ltdBenefitPeriodYears != null) {
    body.ltdBenefitPeriodYears = f.ltdBenefitPeriodYears;
  }
  return body;
}

/** The same rules `validateCrossFields` enforces, checked here so the advisor
 *  reads a sentence instead of a 400. */
function formErrors(f: DisabilityFormValues): string[] {
  const out: string[] = [];
  if (f.name.trim() === "") out.push("Give the policy a name.");
  if (!f.hasShortTerm && !f.hasLongTerm) {
    out.push("A policy must cover short-term, long-term, or both.");
  }
  if (f.coveredEarningsMode === "manual" && f.coveredEarningsAmount == null) {
    out.push("Manual covered earnings require an amount.");
  }
  if (f.hasLongTerm && f.ltdBenefitPeriodMode === "to_age" && f.ltdBenefitPeriodAge == null) {
    out.push("A to-age benefit period requires an age.");
  }
  if (f.hasLongTerm && f.ltdBenefitPeriodMode === "years" && f.ltdBenefitPeriodYears == null) {
    out.push("A fixed benefit period requires a number of years.");
  }
  if (f.hasShortTerm) {
    if (f.stdDurationWeeks == null) out.push("Short-term coverage needs a duration in weeks.");
    else if (f.stdDurationWeeks * 7 <= f.stdEliminationDays) {
      out.push("Short-term duration must be longer than the waiting period.");
    }
  }
  return out;
}

const DURATION_HELP =
  "Counted from the first day of disability, so the waiting period is inside it.";
const TAXABLE_HELP =
  "Benefits are taxable when the employer pays the premium, and tax-free when you pay it with after-tax dollars.";

/** decimal 0.6 → "60", without the 0.6 × 100 = 60.00000000000001 drift that a
 *  naive round-trip would write back into the column. */
const asPercent = (d: number) => String(Math.round(d * 1000) / 10);
const fromPercent = (v: string) => (v === "" ? 0 : Number(v) / 100);
/** An empty money field is NULL, not 0 — a blank monthly cap means uncapped. */
const asMoney = (n: number | null) => (n == null ? "" : String(n));
const fromMoney = (v: string) => (v === "" ? null : Number(v));

interface BaseProps {
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  /** `resolveCoveredEarnings`'s SALARY branch, resolved server-side per person
   *  where the pre-clip income rows live. Manual mode is resolved here — see
   *  `coveredEarningsFor`. */
  currentSalaryByPerson: { client: number; spouse: number };
  currentYear: number;
  /** Both are what the ENGINE's manual covered-earnings branch reads. Without
   *  them this screen previewed a manual policy off its raw amount while the
   *  projection paid an inflated one. */
  planStartYear: number;
  inflationRate: number;
  planEndYear: number;
  client: ClientInfo;
  onClose: () => void;
  onSaved: () => void;
}

/** `mode` is the discriminator, never the presence of `policy`. */
export type DisabilityPolicyDialogProps = BaseProps &
  ({ mode: "create" } | { mode: "edit"; policy: DisabilityPolicy });

export default function DisabilityPolicyDialog(props: DisabilityPolicyDialogProps) {
  const [form, setForm] = useState<DisabilityFormValues>(() =>
    props.mode === "edit" ? policyToForm(props.policy) : PRIVATE_POLICY_DEFAULTS,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  /** Whether the advisor has set the taxable switch themselves. An explicit
   *  value, not the presence of anything: once it is true a payer change stops
   *  seeding `benefitTaxable`, so a deliberate split-premium "Tax-free" survives
   *  re-picking the payer. */
  const [benefitTaxableTouched, setBenefitTaxableTouched] = useState(false);

  const set = (patch: Partial<DisabilityFormValues>) => {
    // Editing anything disarms the two-click remove. Left armed it never
    // expired: an advisor who armed it, thought better of it, worked on in the
    // form and later pressed the button expecting to ARM it deleted the policy
    // on that press.
    setConfirmingRemove(false);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const errors = formErrors(form);
  const omissions = previewOmissions(form);

  const draft = formToPolicy(form, props.mode === "edit" ? props.policy.id : "draft");
  // The engine's own resolver, so the preview and the projection cannot disagree
  // about what this policy insures — in manual mode as well as salary mode.
  const coveredEarnings = coveredEarningsFor(draft, {
    salaryByPerson: props.currentSalaryByPerson,
    client: props.client,
    startYear: props.currentYear,
    planStartYear: props.planStartYear,
    inflationRate: props.inflationRate,
  });

  const coverage = resolveCoverage(
    draft,
    coveredEarnings,
    props.currentYear,
    props.client,
    props.planEndYear,
  );

  async function save() {
    if (errors.length > 0) return;
    setSaving(true);
    setSaveError(null);
    const url =
      props.mode === "edit"
        ? `/api/clients/${props.clientId}/disability-policies/${props.policy.id}`
        : `/api/clients/${props.clientId}/disability-policies`;
    let ok = false;
    try {
      const res = await fetch(url, {
        method: props.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(disabilityPolicyBody(form)),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    if (!ok) {
      // Never `alert()`: an alert plus an early return is invisible to a test
      // and to a screen reader.
      setSaveError("Could not save this policy. Please try again.");
      return;
    }
    props.onSaved();
  }

  async function remove() {
    if (props.mode !== "edit") return;
    setSaving(true);
    setSaveError(null);
    let ok = false;
    try {
      const res = await fetch(
        `/api/clients/${props.clientId}/disability-policies/${props.policy.id}`,
        { method: "DELETE" },
      );
      ok = res.ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    if (!ok) {
      setSaveError("Could not remove this policy. Please try again.");
      return;
    }
    props.onSaved();
  }

  const spouseOptionLabel =
    props.spouseFirstName ?? (form.insured === "spouse" ? "Spouse (not on file)" : null);
  const insuredOptions = [
    { value: "client", label: props.clientFirstName },
    ...(spouseOptionLabel === null ? [] : [{ value: "spouse", label: spouseOptionLabel }]),
  ];

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={props.mode === "edit" ? "Edit disability policy" : "Add disability policy"}
      size="lg"
      primaryAction={{
        label: "Save",
        onClick: () => void save(),
        disabled: errors.length > 0,
        loading: saving,
      }}
      destructiveAction={
        props.mode === "edit"
          ? {
              label: confirmingRemove ? "Really remove it?" : "Remove policy",
              onClick: () => {
                if (confirmingRemove) void remove();
                else setConfirmingRemove(true);
              },
              disabled: saving,
            }
          : undefined
      }
    >
      <div className="flex flex-col gap-6">
        {/* First in the DOM, and the only `role="alert"` while it is showing:
            a save that did not land outranks every warning below it. */}
        {saveError !== null && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
            {saveError}
          </p>
        )}
        <Section title="Who and what's covered">
          <Field label="Policy name">
            <input
              data-autofocus
              aria-label="Policy name"
              className={inputClassName}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Who is covered">
            <select
              aria-label="Who is covered"
              className={selectClassName}
              value={form.insured}
              onChange={(e) => set({ insured: e.target.value as "client" | "spouse" })}
            >
              {insuredOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Covered earnings"
            help="Group plans insure W-2 base pay; business and K-1 income is left out. Enter an amount only when the policy insures something other than today's salary."
          >
            <select
              aria-label="Covered earnings"
              className={selectClassName}
              value={form.coveredEarningsMode}
              onChange={(e) =>
                set({ coveredEarningsMode: e.target.value as "salary" | "manual" })
              }
            >
              <option value="salary">Salary in the plan</option>
              <option value="manual">A set amount</option>
            </select>
          </Field>
          {form.coveredEarningsMode === "manual" && (
            <Field label="Covered earnings amount">
              <input
                type="number"
                aria-label="Covered earnings amount"
                className={inputClassName}
                value={asMoney(form.coveredEarningsAmount)}
                onChange={(e) => set({ coveredEarningsAmount: fromMoney(e.target.value) })}
              />
            </Field>
          )}
        </Section>

        <Section
          title="Short-term"
          toggle={
            <SwitchControl
              ariaLabel="Short-term coverage"
              stateLabel={form.hasShortTerm ? "On" : "Off"}
              checked={form.hasShortTerm}
              onChange={(next) => set({ hasShortTerm: next })}
            />
          }
        >
          {form.hasShortTerm && (
            <>
              <Field label="Waiting period (days)">
                <input
                  type="number"
                  className={inputClassName}
                  aria-label="Short-term waiting period (days)"
                  value={String(form.stdEliminationDays)}
                  onChange={(e) => set({ stdEliminationDays: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="Benefit (% of earnings)">
                <input
                  type="number"
                  className={inputClassName}
                  aria-label="Short-term benefit (% of earnings)"
                  value={asPercent(form.stdBenefitPct)}
                  onChange={(e) => set({ stdBenefitPct: fromPercent(e.target.value) })}
                />
              </Field>
              <Field label="Duration (weeks)" help={DURATION_HELP}>
                <input
                  type="number"
                  className={inputClassName}
                  aria-label="Short-term duration (weeks)"
                  // Blank stays blank. `Number(v || 0)` wrote a 0 back into the
                  // field the instant the advisor cleared it — a duration they
                  // never typed, in the one field where 0 is not a real answer.
                  value={form.stdDurationWeeks == null ? "" : String(form.stdDurationWeeks)}
                  onChange={(e) =>
                    set({
                      stdDurationWeeks: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Monthly cap" help="Leave blank for no cap — group short-term usually has none.">
                <input
                  type="number"
                  placeholder="No cap"
                  className={inputClassName}
                  aria-label="Short-term monthly cap"
                  value={asMoney(form.stdMonthlyMax)}
                  onChange={(e) => set({ stdMonthlyMax: fromMoney(e.target.value) })}
                />
              </Field>
            </>
          )}
        </Section>

        <Section
          title="Long-term"
          toggle={
            <SwitchControl
              ariaLabel="Long-term coverage"
              stateLabel={form.hasLongTerm ? "On" : "Off"}
              checked={form.hasLongTerm}
              onChange={(next) => set({ hasLongTerm: next })}
            />
          }
        >
          {form.hasLongTerm && (
            <>
              <Field label="Waiting period (days)">
                <input
                  type="number"
                  className={inputClassName}
                  aria-label="Long-term waiting period (days)"
                  value={String(form.ltdEliminationDays)}
                  onChange={(e) => set({ ltdEliminationDays: Number(e.target.value || 0) })}
                />
              </Field>
              <Field label="Benefit (% of earnings)">
                <input
                  type="number"
                  className={inputClassName}
                  aria-label="Long-term benefit (% of earnings)"
                  value={asPercent(form.ltdBenefitPct)}
                  onChange={(e) => set({ ltdBenefitPct: fromPercent(e.target.value) })}
                />
              </Field>
              <Field label="Monthly cap" help="Leave blank for no cap.">
                <input
                  type="number"
                  placeholder="No cap"
                  className={inputClassName}
                  aria-label="Long-term monthly cap"
                  value={asMoney(form.ltdMonthlyMax)}
                  onChange={(e) => set({ ltdMonthlyMax: fromMoney(e.target.value) })}
                />
              </Field>
              <Field label="Benefits run">
                <select
                  aria-label="Long-term benefits run"
                  className={selectClassName}
                  value={form.ltdBenefitPeriodMode}
                  onChange={(e) =>
                    set({
                      ltdBenefitPeriodMode: e.target
                        .value as DisabilityFormValues["ltdBenefitPeriodMode"],
                    })
                  }
                >
                  <option value="to_age">To an age</option>
                  <option value="to_ssnra">To Social Security full retirement age</option>
                  <option value="years">For a number of years</option>
                  <option value="lifetime">For life</option>
                </select>
              </Field>
              {form.ltdBenefitPeriodMode === "to_age" && (
                <Field label="Benefits run to age">
                  <input
                    type="number"
                    className={inputClassName}
                    aria-label="Benefits run to age"
                    value={form.ltdBenefitPeriodAge == null ? "" : String(form.ltdBenefitPeriodAge)}
                    onChange={(e) =>
                      set({
                        ltdBenefitPeriodAge:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
              {form.ltdBenefitPeriodMode === "years" && (
                <Field label="Benefits run for (years)">
                  <input
                    type="number"
                    className={inputClassName}
                    aria-label="Benefits run for (years)"
                    value={
                      form.ltdBenefitPeriodYears == null ? "" : String(form.ltdBenefitPeriodYears)
                    }
                    onChange={(e) =>
                      set({
                        ltdBenefitPeriodYears:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
            </>
          )}
        </Section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink">If a disability started this year</h3>
          {omissions.map((o) => (
            <p key={o} className="rounded-md border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink-2">
              {o}
            </p>
          ))}
          {/* Exactly one `role="alert"` on screen, most-blocking first: a failed
              save is the more blocking of the two and it is rendered above, so
              the coverage warning steps down to `status` while it is showing. */}
          <DisabilityCoverageTimeline
            coverage={coverage}
            alertRole={saveError === null ? "alert" : "status"}
          />
        </section>

        <Section title="Taxes and cost">
          <Field label="Benefits are taxable" help={TAXABLE_HELP}>
            <SwitchControl
              ariaLabel="Benefits are taxable"
              stateLabel={form.benefitTaxable ? "Taxable" : "Tax-free"}
              checked={form.benefitTaxable}
              onChange={(next) => {
                setBenefitTaxableTouched(true);
                set({ benefitTaxable: next });
              }}
            />
          </Field>
          <Field label="Who pays the premium">
            <select
              aria-label="Who pays the premium"
              className={selectClassName}
              value={form.premiumPayer}
              onChange={(e) => {
                const premiumPayer = e.target.value as "employer" | "insured";
                // Seeds the tax treatment only while the advisor has not set it
                // themselves. Seeding it every time destroyed a deliberate
                // choice: record a split-premium policy as tax-free, re-pick
                // "The employer", and it silently flipped back to taxable —
                // settable, but not sticky, and stickiness is the half a split
                // premium needs.
                set(
                  benefitTaxableTouched
                    ? { premiumPayer }
                    : { premiumPayer, benefitTaxable: premiumPayer === "employer" },
                );
              }}
            >
              <option value="employer">The employer</option>
              <option value="insured">The insured, with after-tax dollars</option>
            </select>
          </Field>
          <Field
            label="Annual increase (%)"
            help="Indexes the benefit from the second disability year onward. Leave at 0 for a fixed benefit."
          >
            <input
              type="number"
              className={inputClassName}
              aria-label="Annual increase (%)"
              value={asPercent(form.colaRate)}
              onChange={(e) => set({ colaRate: fromPercent(e.target.value) })}
            />
          </Field>
          <Field label="Annual premium">
            <input
              type="number"
              className={inputClassName}
              aria-label="Annual premium"
              value={String(form.annualPremium)}
              onChange={(e) => set({ annualPremium: Number(e.target.value || 0) })}
            />
          </Field>
        </Section>

        {errors.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </DialogShell>
  );
}

function Section({
  title,
  toggle,
  children,
}: {
  title: string;
  toggle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-hair p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {toggle}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Label text and the "?" badge sit side by side ABOVE the control, and the
 *  control names itself with `aria-label`. The badge is a button, so it must
 *  not live inside a <label> — that would make it an interactive descendant of
 *  the labelled control. Same shape as `solver-stress-test-tab.tsx`. */
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5">
        <span className={fieldLabelClassName}>{label}</span>
        {help === undefined ? null : <FieldTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}
