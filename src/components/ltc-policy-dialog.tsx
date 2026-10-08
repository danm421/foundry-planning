// src/components/ltc-policy-dialog.tsx
"use client";

/**
 * Create / edit one long-term care policy.
 *
 * ONE SHAPE. The form is the engine's flat `LtcPolicy` minus `id` (the issue
 * year may be blank while the advisor retypes it). Every save sends the WHOLE
 * normalized form — as the base POST/PATCH body, as a scenario add's entity,
 * or as a scenario edit's desired fields — so the three paths cannot drift.
 */

import { useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import DialogShell from "@/components/dialog-shell";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SwitchControl } from "@/components/forms/switch-control";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
  textareaClassName,
} from "@/components/forms/input-styles";
import type { LtcPolicy } from "@/engine/types";
import { LTC_STANDALONE_DEFAULTS, ltcPolicyCreateSchema, ltcPolicyProblems } from "@/lib/schemas/ltc-policies";
import {
  normalizeLtcPolicyFields,
  withLtcKind,
  type LtcPolicyFields,
} from "@/lib/insurance-policies/ltc-policy-fields";
import { eligibleRiderPolicies } from "@/lib/insurance-policies/ltc-rider-link";
import { ltcSummaryText } from "@/lib/insurance-policies/ltc-labels";
import { personLabel } from "@/lib/owner-labels";

/** A life policy a rider can name, from the scenario's effective tree. */
export interface LtcLifePolicyOption {
  id: string;
  name: string;
  insuredPerson: "client" | "spouse" | "joint" | null;
  faceValue: number;
}

export type LtcFormValues = Omit<LtcPolicyFields, "issueYear"> & { issueYear: number | null };

function emptyForm(currentYear: number): LtcFormValues {
  return {
    name: "",
    insured: "client",
    carrier: null,
    ...LTC_STANDALONE_DEFAULTS,
    issueYear: currentYear,
    annualPremium: 0,
    partnership: false,
    notes: null,
  };
}

function policyToForm(p: LtcPolicy): LtcFormValues {
  const fields: Partial<LtcPolicy> = { ...p };
  delete fields.id;
  return fields as LtcFormValues;
}

/** What each numeric field is called on screen, and whether its bounds read as percentages. */
const RANGE_FIELDS: Record<string, { label: string; percent?: true }> = {
  issueYear: { label: "Issue year" },
  benefitAmount: { label: "Benefit amount" },
  riderMonthlyPct: { label: "Monthly share of death benefit (%)", percent: true },
  benefitPeriodYears: { label: "Benefit years" },
  riderMaxPct: { label: "Can pay out up to (% of death benefit)", percent: true },
  extensionYears: { label: "Extension (years)" },
  residualDeathBenefit: { label: "Guaranteed death benefit" },
  eliminationDays: { label: "Waiting period (days)" },
  homeCarePct: { label: "Home care pays (% of limit)", percent: true },
  inflationRate: { label: "Inflation rate (%)", percent: true },
  annualPremium: { label: "Annual premium" },
  premiumPayToAge: { label: "Premiums paid to age" },
  premiumPayYears: { label: "Premiums paid for (years)" },
};

/** One sentence per out-of-range number, with the bound read from the schema's
 *  own issue so the ranges live in exactly one place. */
function rangeSentences(f: LtcFormValues, issueYear: number, skip: Set<string>): string[] {
  const parsed = ltcPolicyCreateSchema.safeParse(normalizeLtcPolicyFields({ ...f, issueYear }));
  if (parsed.success) return [];
  const seen = new Set<string>(skip);
  const out: string[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    const field = RANGE_FIELDS[key];
    if (!field || seen.has(key)) continue;
    const bound = (n: unknown) => (field.percent ? `${Math.round(Number(n) * 10000) / 100}%` : String(n));
    let sentence: string | null = null;
    if (issue.code === "too_small") {
      sentence = `${field.label} must be ${issue.inclusive ? "at least" : "more than"} ${bound(issue.minimum)}.`;
    } else if (issue.code === "too_big") {
      sentence = `${field.label} must be at most ${bound(issue.maximum)}.`;
    } else if (issue.code === "invalid_type" && issue.expected === "int") {
      sentence = `${field.label} must be a whole number.`;
    }
    if (sentence === null) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out;
}

/** Sentences for everything that blocks a save: the schema's own cross-field
 *  rules (one list, shared with the routes) plus what only this screen knows. */
export function ltcFormErrors(f: LtcFormValues, lifePolicies: LtcLifePolicyOption[]): string[] {
  const out: string[] = [];
  if (f.name.trim() === "") out.push("Give the policy a name.");
  if (f.issueYear == null) out.push("Enter the year the policy was issued.");
  const problems = ltcPolicyProblems(f);
  for (const p of problems) out.push(p.message);
  if (f.issueYear != null) out.push(...rangeSentences(f, f.issueYear, new Set(problems.map((p) => p.path))));
  if (f.kind === "life_rider" && f.lifePolicyAccountId) {
    const linked = lifePolicies.find((o) => o.id === f.lifePolicyAccountId);
    if (!linked) out.push("Its life policy isn't in this scenario. Pick another one.");
    else if (eligibleRiderPolicies(f.insured, [linked]).length === 0) {
      out.push("The life policy must insure the same person as the rider.");
    }
  }
  return out;
}

/** decimal 0.035 → "3.5", without float drift; blank stays blank. */
const asPercent = (d: number | null) => (d == null ? "" : String(Math.round(d * 10000) / 100));
const fromPercent = (v: string) => (v === "" ? 0 : Number(v) / 100);
const fromPercentOrNull = (v: string) => (v === "" ? null : Number(v) / 100);
const asNumber = (n: number | null) => (n == null ? "" : String(n));
const fromNumber = (v: string) => (v === "" ? 0 : Number(v));
const fromNumberOrNull = (v: string) => (v === "" ? null : Number(v));

interface BaseProps {
  clientId: string;
  clientFirstName: string;
  spouseFirstName: string | null;
  lifePolicies: LtcLifePolicyOption[];
  currentYear: number;
  onClose: () => void;
  onSaved: () => void;
}

/** `mode` is the discriminator, never the presence of `policy`. */
export type LtcPolicyDialogProps = BaseProps & ({ mode: "create" } | { mode: "edit"; policy: LtcPolicy });

export default function LtcPolicyDialog(props: LtcPolicyDialogProps) {
  const writer = useScenarioWriter(props.clientId);
  // Minted once per create dialog, so a retry re-sends the SAME id.
  const [newId] = useState(() => (props.mode === "create" ? crypto.randomUUID() : null));
  const [form, setForm] = useState<LtcFormValues>(() =>
    props.mode === "edit" ? policyToForm(props.policy) : emptyForm(props.currentYear),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const set = (patch: Partial<LtcFormValues>) => {
    // Editing anything disarms the two-click remove.
    setConfirmingRemove(false);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const names = { clientName: props.clientFirstName, spouseName: props.spouseFirstName };
  const errors = ltcFormErrors(form, props.lifePolicies);
  const eligible = eligibleRiderPolicies(form.insured, props.lifePolicies);
  const linked = props.lifePolicies.find((o) => o.id === form.lifePolicyAccountId) ?? null;
  const summary =
    form.issueYear == null
      ? null
      : ltcSummaryText({ id: "draft", ...form, issueYear: form.issueYear }, linked?.faceValue ?? null, props.currentYear);
  const isRider = form.kind === "life_rider";
  // "" unless the stored id is one of the options, so a stale link shows the
  // placeholder and picking a real policy always fires a change.
  const pickedLife = eligible.find((o) => o.id === form.lifePolicyAccountId)?.id ?? "";

  function setInsured(insured: "client" | "spouse") {
    // A rider's life policy must be the insured's own; drop one that is not.
    const keep = !isRider || eligibleRiderPolicies(insured, props.lifePolicies).some((o) => o.id === form.lifePolicyAccountId);
    set({ insured, lifePolicyAccountId: keep ? form.lifePolicyAccountId : null });
  }

  function setKind(kind: LtcPolicy["kind"]) {
    set({ ...withLtcKind(form, kind), lifePolicyAccountId: kind === "life_rider" ? (eligible[0]?.id ?? null) : null });
  }

  async function save() {
    if (errors.length > 0 || form.issueYear == null) return;
    setSaving(true);
    setSaveError(null);
    let ok = false;
    try {
      const fields = normalizeLtcPolicyFields({ ...form, issueYear: form.issueYear });
      const res = await writer.submit(
        props.mode === "edit"
          ? { op: "edit", targetKind: "ltc_policy", targetId: props.policy.id, desiredFields: { ...fields } }
          : { op: "add", targetKind: "ltc_policy", entity: { id: newId!, ...fields } },
        {
          url:
            props.mode === "edit"
              ? `/api/clients/${props.clientId}/ltc-policies/${props.policy.id}`
              : `/api/clients/${props.clientId}/ltc-policies`,
          method: props.mode === "edit" ? "PATCH" : "POST",
          body: fields,
        },
      );
      ok = res.ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    if (!ok) {
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
      const res = await writer.submit(
        { op: "remove", targetKind: "ltc_policy", targetId: props.policy.id },
        { url: `/api/clients/${props.clientId}/ltc-policies/${props.policy.id}`, method: "DELETE" },
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

  return (
    <DialogShell
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={props.mode === "edit" ? "Edit long-term care policy" : "Add long-term care policy"}
      size="lg"
      primaryAction={{ label: "Save", onClick: () => void save(), disabled: errors.length > 0, loading: saving }}
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
        {saveError !== null && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
            {saveError}
          </p>
        )}
        {summary !== null && (
          <p className="rounded-md border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink">{summary}</p>
        )}

        <Section title="Who and type">
          <Field label="Policy name">
            <input data-autofocus aria-label="Policy name" className={inputClassName} value={form.name}
              onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Carrier">
            <input aria-label="Carrier" className={inputClassName} value={form.carrier ?? ""}
              onChange={(e) => set({ carrier: e.target.value })} />
          </Field>
          <Field label="Who is covered">
            <select aria-label="Who is covered" className={selectClassName} value={form.insured}
              onChange={(e) => setInsured(e.target.value as "client" | "spouse")}>
              <option value="client">{props.clientFirstName}</option>
              {(props.spouseFirstName !== null || form.insured === "spouse") && (
                <option value="spouse">{personLabel("spouse", names)}</option>
              )}
            </select>
          </Field>
          <Field label="Type" help="A rider is part of a life policy: what it pays for care comes out of the death benefit.">
            <select aria-label="Type" className={selectClassName} value={form.kind}
              onChange={(e) => setKind(e.target.value as LtcPolicy["kind"])}>
              <option value="standalone">Traditional policy</option>
              <option value="life_rider" disabled={eligible.length === 0 && !isRider}>Rider on a life policy</option>
            </select>
            {eligible.length === 0 && !isRider && (
              <p className="mt-1 text-[12px] text-ink-3">
                No life policy on file for {personLabel(form.insured, names)}, so a rider can&apos;t be added yet.
              </p>
            )}
          </Field>
          {isRider && (
            <Field label="Life policy">
              {/* `pickedLife`, not the stored id: a rider whose life policy left
                  this scenario, or is no longer eligible, shows "Pick a policy"
                  instead of a value no option carries. */}
              <select aria-label="Life policy" className={selectClassName} value={pickedLife}
                onChange={(e) => set({ lifePolicyAccountId: e.target.value || null })}>
                {pickedLife === "" && <option value="">Pick a policy</option>}
                {eligible.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Issue year" help="Inflation protection grows the benefit from this year.">
            <input type="number" aria-label="Issue year" className={inputClassName} value={asNumber(form.issueYear)}
              onChange={(e) => set({ issueYear: fromNumberOrNull(e.target.value) })} />
          </Field>
        </Section>

        <Section title="Benefit">
          {isRider ? (
            <>
              <Field label="Rider pays">
                <select aria-label="Rider pays" className={selectClassName} value={form.riderBenefitMode ?? "pct_of_face"}
                  onChange={(e) => set({ riderBenefitMode: e.target.value as "pct_of_face" | "fixed" })}>
                  <option value="pct_of_face">A share of the death benefit each month</option>
                  <option value="fixed">A set amount</option>
                </select>
              </Field>
              {form.riderBenefitMode === "pct_of_face" ? (
                <Field label="Monthly share of death benefit (%)">
                  <input type="number" aria-label="Monthly share of death benefit (%)" className={inputClassName}
                    value={asPercent(form.riderMonthlyPct)}
                    onChange={(e) => set({ riderMonthlyPct: fromPercentOrNull(e.target.value) })} />
                </Field>
              ) : (
                <BenefitAmountFields form={form} set={set} />
              )}
              <Field label="Can pay out up to (% of death benefit)">
                <input type="number" aria-label="Can pay out up to (% of death benefit)" className={inputClassName}
                  value={asPercent(form.riderMaxPct)} onChange={(e) => set({ riderMaxPct: fromPercentOrNull(e.target.value) })} />
              </Field>
              <Field label="Extension (years)" help="Hybrid policies keep paying for these years after the death benefit is used up.">
                <input type="number" aria-label="Extension (years)" className={inputClassName}
                  value={String(form.extensionYears)} onChange={(e) => set({ extensionYears: fromNumber(e.target.value) })} />
              </Field>
              <Field label="Guaranteed death benefit" help="The least the policy still pays at death, however much care it paid for.">
                <input type="number" aria-label="Guaranteed death benefit" className={inputClassName}
                  value={String(form.residualDeathBenefit)}
                  onChange={(e) => set({ residualDeathBenefit: fromNumber(e.target.value) })} />
              </Field>
            </>
          ) : (
            <>
              <BenefitAmountFields form={form} set={set} />
              <Field label="Benefits last">
                <select aria-label="Benefits last" className={selectClassName} value={form.benefitPeriodMode ?? "years"}
                  onChange={(e) => set({ benefitPeriodMode: e.target.value as "years" | "lifetime" })}>
                  <option value="years">For a number of years</option>
                  <option value="lifetime">For life</option>
                </select>
              </Field>
              {form.benefitPeriodMode === "years" && (
                <Field label="Benefit years" help="Sets the policy's pool: the monthly benefit × 12 × these years.">
                  <input type="number" aria-label="Benefit years" className={inputClassName}
                    value={asNumber(form.benefitPeriodYears)}
                    onChange={(e) => set({ benefitPeriodYears: fromNumberOrNull(e.target.value) })} />
                </Field>
              )}
            </>
          )}
        </Section>

        <Section title="When it pays">
          <Field label="Waiting period (days)" help="Care days the household pays for before benefits start.">
            <input type="number" aria-label="Waiting period (days)" className={inputClassName}
              value={String(form.eliminationDays)} onChange={(e) => set({ eliminationDays: fromNumber(e.target.value) })} />
          </Field>
          <Field label="Home care pays (% of limit)">
            <input type="number" aria-label="Home care pays (% of limit)" className={inputClassName}
              value={asPercent(form.homeCarePct)} onChange={(e) => set({ homeCarePct: fromPercent(e.target.value) })} />
          </Field>
          <Field label="Policy pays" help="Most policies pay actual care costs up to the limit. A cash (indemnity) policy pays the full limit.">
            <select aria-label="Policy pays" className={selectClassName} value={form.benefitType}
              onChange={(e) => set({ benefitType: e.target.value as LtcPolicy["benefitType"] })}>
              <option value="reimbursement">Actual care costs, up to the limit</option>
              <option value="indemnity">The full limit, whatever care costs</option>
            </select>
          </Field>
          {!isRider && (
            <Field label="Shared care" help="Each person can draw on the other's pool once their own runs out.">
              <SwitchControl ariaLabel="Shared care" stateLabel={form.sharedCare ? "On" : "Off"}
                checked={form.sharedCare} onChange={(next) => set({ sharedCare: next })} />
            </Field>
          )}
          <Field label="State partnership policy" help="Recorded for reference. Medicaid is not modeled.">
            <SwitchControl ariaLabel="State partnership policy" stateLabel={form.partnership ? "Yes" : "No"}
              checked={form.partnership} onChange={(next) => set({ partnership: next })} />
          </Field>
        </Section>

        <Section title="Inflation">
          <Field label="Inflation protection">
            <select aria-label="Inflation protection" className={selectClassName} value={form.inflationRider}
              onChange={(e) => set({ inflationRider: e.target.value as LtcPolicy["inflationRider"] })}>
              <option value="none">None</option>
              <option value="simple">Simple</option>
              <option value="compound">Compound</option>
            </select>
          </Field>
          {form.inflationRider !== "none" && (
            <Field label="Inflation rate (%)">
              <input type="number" aria-label="Inflation rate (%)" className={inputClassName}
                value={asPercent(form.inflationRate)} onChange={(e) => set({ inflationRate: fromPercent(e.target.value) })} />
            </Field>
          )}
        </Section>

        {!isRider && (
          <Section title="Premium">
            <Field label="Annual premium">
              <input type="number" aria-label="Annual premium" className={inputClassName}
                value={String(form.annualPremium)} onChange={(e) => set({ annualPremium: fromNumber(e.target.value) })} />
            </Field>
            <Field label="Premiums paid">
              <select aria-label="Premiums paid" className={selectClassName} value={form.premiumPayMode}
                onChange={(e) => set({ premiumPayMode: e.target.value as LtcPolicy["premiumPayMode"] })}>
                <option value="lifetime">For life</option>
                <option value="to_age">To an age</option>
                <option value="years">For a number of years</option>
                <option value="paid_up">Paid up</option>
              </select>
            </Field>
            {form.premiumPayMode === "to_age" && (
              <Field label="Premiums paid to age">
                <input type="number" aria-label="Premiums paid to age" className={inputClassName}
                  value={asNumber(form.premiumPayToAge)}
                  onChange={(e) => set({ premiumPayToAge: fromNumberOrNull(e.target.value) })} />
              </Field>
            )}
            {form.premiumPayMode === "years" && (
              <Field label="Premiums paid for (years)" help="Counted from the issue year.">
                <input type="number" aria-label="Premiums paid for (years)" className={inputClassName}
                  value={asNumber(form.premiumPayYears)}
                  onChange={(e) => set({ premiumPayYears: fromNumberOrNull(e.target.value) })} />
              </Field>
            )}
          </Section>
        )}

        <Section title="Notes">
          <div className="sm:col-span-2">
            <textarea aria-label="Notes" rows={3} className={textareaClassName} value={form.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value })} />
          </div>
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

/** The amount and its unit — a standalone benefit, or a fixed-amount rider. */
function BenefitAmountFields({
  form,
  set,
}: {
  form: LtcFormValues;
  set: (patch: Partial<LtcFormValues>) => void;
}) {
  return (
    <>
      <Field label="Benefit amount">
        <input type="number" aria-label="Benefit amount" className={inputClassName}
          value={String(form.benefitAmount)} onChange={(e) => set({ benefitAmount: fromNumber(e.target.value) })} />
      </Field>
      <Field label="Benefit per">
        <select aria-label="Benefit per" className={selectClassName} value={form.benefitUnit}
          onChange={(e) => set({ benefitUnit: e.target.value as "day" | "month" })}>
          <option value="month">Month</option>
          <option value="day">Day</option>
        </select>
      </Field>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-hair p-4">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Label and "?" badge ABOVE the control; the control names itself with
 *  aria-label (the badge is a button and must not sit inside a <label>). */
function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
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
