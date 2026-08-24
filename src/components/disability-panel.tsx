"use client";

/**
 * Disability policies on the Insurance details page.
 *
 * Every figure a row shows comes from `resolveCoverage` / `benefitForYear` —
 * the same functions the projection pays on. A second derivation here is how a
 * screen and its engine drift apart.
 *
 * The inline cells write ONE key each, which is safe only because `colaRate`
 * and `annualPremium` appear nowhere in the update schema's cross-field check.
 * Everything the check reads — the two coverage switches, the covered-earnings
 * mode, the benefit-period mode — is edited in the dialog, which sends the
 * whole form. See `disability-policy-dialog.tsx` for why.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";
import { InlineAmount } from "@/components/forms/inline-amount";
import { usePendingEdits } from "@/hooks/use-pending-edits";
import DisabilityPolicyDialog, {
  coveredEarningsFor,
  formToPolicy,
  policyToForm,
  type DisabilityFormValues,
} from "@/components/disability-policy-dialog";
import {
  benefitForYear,
  resolveCoverage,
  type ResolvedCoverage,
} from "@/engine/disability-benefits";
import type { ClientInfo, DisabilityPolicy } from "@/engine/types";
import { WORKPLACE_DEFAULTS } from "@/lib/schemas/disability-policies";

export interface DisabilityPanelProps {
  clientId: string;
  policies: DisabilityPolicy[];
  clientFirstName: string;
  spouseFirstName: string | null;
  /** This year's covered earnings per person in SALARY mode, produced by the
   *  engine's own `resolveCoveredEarnings` on the server, where the pre-clip
   *  income rows live. Manual mode is resolved in `coveredEarningsFor`. */
  currentSalaryByPerson: { client: number; spouse: number };
  currentYear: number;
  /** The two inputs the engine's MANUAL covered-earnings branch reads. The row
   *  previewed off the raw amount without them, so a manual policy's benefit
   *  read below what the projection pays, by more the older the plan. */
  planStartYear: number;
  inflationRate: number;
  planEndYear: number;
  client: ClientInfo;
}

/**
 * Flat, not `{ policy }`. `usePendingEdits` merges by TOP-LEVEL key, so a
 * nested policy object could not carry an optimistic `colaRate` and the cell
 * would sit dead until the round-trip landed — the same reason
 * `insurance-panel.tsx` flattens into `InsuranceEditRow`.
 */
type DisabilityEditRow = DisabilityFormValues & { id: string };

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** decimal 0.6 → "60%", without the 0.6 × 100 float drift. */
const pct = (d: number) => `${Math.round(d * 1000) / 10}%`;

/** A null max means UNCAPPED. Rendering it as "$0/mo cap" would claim the
 *  policy pays nothing. */
const capLabel = (max: number | null) =>
  max == null ? "No monthly cap" : `${money.format(max)}/mo cap`;

/** "for 13 weeks". The null arm exists because the form type allows a cleared
 *  field, not because it renders: the line above is gated on a RESOLVED
 *  short-term window, and a window only resolves when the duration is a number.
 *  Without it the template would print "for null weeks". Same shape as
 *  `benefitPeriodLabel` below. */
function durationLabel(weeks: number | null): string {
  return weeks == null ? "for a duration not yet set" : `for ${weeks} weeks`;
}

function benefitPeriodLabel(row: DisabilityEditRow): string {
  switch (row.ltdBenefitPeriodMode) {
    case "to_age":
      return row.ltdBenefitPeriodAge == null
        ? "to an age not yet set"
        : `to age ${row.ltdBenefitPeriodAge}`;
    case "to_ssnra":
      return "to Social Security full retirement age";
    case "years":
      return row.ltdBenefitPeriodYears == null
        ? "for a term not yet set"
        : `for ${row.ltdBenefitPeriodYears} years`;
    case "lifetime":
      return "for life";
  }
}

/** At most one warning per row, most-blocking first, where "most blocking" is
 *  how many layers the condition stops paying.
 *
 *  The precedence, the scope of each claim and the conditions themselves mirror
 *  `disability-coverage-timeline.tsx` exactly — the row and the timeline must
 *  not tell the advisor two different stories about one policy. Nothing but
 *  wording differs, and `disability-panel.test.tsx` renders BOTH surfaces on the
 *  same fixtures to keep it that way. Change one of these two functions and you
 *  must change the other. */
function coverageWarning(c: ResolvedCoverage): { tone: "crit" | "warn"; text: string } | null {
  if (c.coveredEarnings <= 0 && (c.shortTerm !== null || c.longTerm !== null)) {
    // FIRST because it kills BOTH layers: every band pays $0 and no field on
    // this screen changes that. Reachable, not theoretical — in salary mode
    // `resolveCoveredEarnings` returns 0 whenever the insured has no salary rows
    // this year. The coverage lines are gated on the policy's sections, never on
    // earnings, so they read as real cover while the benefit column shows $0 —
    // unless we say why.
    return { tone: "crit", text: "No covered earnings on file, so this pays nothing" };
  }
  if (c.unresolved === "missing_dob") {
    // Scoped to the long-term layer on purpose, and ranked BELOW zero earnings
    // because it stops one layer rather than two. `resolveCoverage` builds the
    // short-term window from `policy.shortTerm` alone and never consults a date
    // of birth, so short-term still resolves and the projection still pays it —
    // a blanket "this policy pays nothing" contradicts the short-term line
    // rendered right beside this pill.
    return {
      tone: "crit",
      text: "No date of birth on file, so long-term coverage pays nothing",
    };
  }
  if (c.seam?.kind === "gap") {
    return {
      tone: "warn",
      text: `${c.seam.months.toFixed(1)} months with no benefit between the two layers`,
    };
  }
  if (c.seam?.kind === "overlap") {
    return { tone: "warn", text: `Both layers pay for ${c.seam.months.toFixed(1)} months` };
  }
  return null;
}

export default function DisabilityPanel(props: DisabilityPanelProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();

  const [dialogState, setDialogState] = useState<
    { mode: "create" } | { mode: "edit"; policy: DisabilityPolicy } | null
  >(null);
  const [choosingInsured, setChoosingInsured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: DisabilityEditRow[] = useMemo(
    () => props.policies.map((p) => ({ id: p.id, ...policyToForm(p) })),
    [props.policies],
  );

  // This panel holds no row state — it renders props and re-renders via
  // `router.refresh()`. Without the overlay every inline edit sits unchanged
  // until the round-trip lands, which reads as a dead control.
  const pending = usePendingEdits(rows);

  async function savePolicyField(
    policyId: string,
    patch: Record<string, unknown>,
    optimistic: Partial<DisabilityEditRow>,
  ): Promise<boolean> {
    return pending.apply(policyId, optimistic, async () => {
      const res = await fetch(
        `/api/clients/${props.clientId}/disability-policies/${policyId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (res.ok) {
        router.refresh();
        return true;
      }
      setError("Could not save that change. Please try again.");
      return false;
    });
  }

  async function addWorkplaceCoverage(insured: "client" | "spouse") {
    setChoosingInsured(false);
    setError(null);
    const res = await fetch(`/api/clients/${props.clientId}/disability-policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // WORKPLACE_DEFAULTS comes from the schema module so the API and this
      // screen cannot drift on what "typical" means. It carries
      // `stdMonthlyMax: null` — uncapped — and that null must reach the column.
      body: JSON.stringify({ ...WORKPLACE_DEFAULTS, insured }),
    });
    if (!res.ok) {
      // An alert() plus an early return is invisible to a test and to a screen
      // reader. The failure belongs in component state.
      setError("Could not add coverage. Please try again.");
      return;
    }
    const { policy } = (await res.json()) as { policy: DisabilityPolicy };
    router.refresh();
    setDialogState({ mode: "edit", policy });
  }

  function startWorkplaceAdd() {
    setError(null);
    // With no spouse there is only one person to insure, so asking would be
    // a question with one answer.
    if (props.spouseFirstName === null) {
      void addWorkplaceCoverage("client");
      return;
    }
    setChoosingInsured(true);
  }

  const insuredLabel = (insured: "client" | "spouse") =>
    insured === "spouse" ? (props.spouseFirstName ?? "Spouse") : props.clientFirstName;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Disability</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-[var(--radius-sm)] bg-accent px-3 h-9 text-[13px] font-medium text-accent-on hover:bg-accent-ink"
              onClick={startWorkplaceAdd}
            >
              Add workplace coverage
            </button>
            <button
              type="button"
              className="rounded-[var(--radius-sm)] border border-hair px-3 h-9 text-[13px] font-medium text-ink-2 hover:border-hair-2 hover:text-ink"
              onClick={() => {
                setError(null);
                setChoosingInsured(false);
                setDialogState({ mode: "create" });
              }}
            >
              Add policy
            </button>
          </div>
        )}
      </header>

      {choosingInsured && props.spouseFirstName !== null && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-hair bg-card p-3 text-[13px]">
          <span className="text-ink-2">Who is covered?</span>
          <button
            type="button"
            className="rounded-[var(--radius-sm)] border border-hair px-3 h-8 text-ink hover:border-hair-2"
            onClick={() => void addWorkplaceCoverage("client")}
          >
            {props.clientFirstName}
          </button>
          <button
            type="button"
            className="rounded-[var(--radius-sm)] border border-hair px-3 h-8 text-ink hover:border-hair-2"
            onClick={() => void addWorkplaceCoverage("spouse")}
          >
            {props.spouseFirstName}
          </button>
          <button
            type="button"
            className="ml-auto text-ink-3 hover:text-ink"
            onClick={() => setChoosingInsured(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          {error}
        </p>
      )}

      {pending.rows.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-hair bg-card p-6">
          {/* The empty state's own words are a claim. It names what is absent
              and what a disability would cost — it must not describe coverage
              this household does not have. */}
          <p className="text-[14px] font-medium text-ink">No disability coverage on file</p>
          <p className="mt-1 text-[13px] text-ink-2">
            A disability today would stop the paycheck with nothing replacing it. Add the
            workplace policy most employers provide, or enter a private one.
          </p>
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="py-2 font-medium">Policy</th>
              <th className="font-medium">Insured</th>
              <th className="font-medium">Coverage</th>
              <th className="text-right font-medium">First-year benefit</th>
              <th className="font-medium">Tax</th>
              <th className="text-right font-medium">Annual increase</th>
              <th className="text-right font-medium">Premium</th>
              <th>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pending.rows.map((row) => {
              const policy = formToPolicy(row, row.id);
              // The engine's own resolver, shared with the dialog, so the row's
              // preview and the projection cannot disagree about what the policy
              // insures — in manual mode as well as salary mode.
              const coveredEarnings = coveredEarningsFor(policy, {
                salaryByPerson: props.currentSalaryByPerson,
                client: props.client,
                startYear: props.currentYear,
                planStartYear: props.planStartYear,
                inflationRate: props.inflationRate,
              });
              const coverage = resolveCoverage(
                policy,
                coveredEarnings,
                props.currentYear,
                props.client,
                props.planEndYear,
              );
              const firstYear = benefitForYear(
                coverage,
                props.currentYear,
                props.currentYear,
                row.colaRate,
              );
              const warning = coverageWarning(coverage);
              return (
                <tr key={row.id} className="border-t border-hair align-top">
                  <td className="py-2 text-ink">{row.name}</td>
                  <td className="text-ink-2">{insuredLabel(row.insured)}</td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1.5">
                      {/* Gated on the RESOLVED window, not on the form switch.
                          Gated on the switch, a policy whose long-term period
                          cannot resolve still advertised "60% to age 65" as live
                          cover while the timeline drew no band at all — the two
                          surfaces describing one policy differently. */}
                      {coverage.shortTerm !== null && (
                        <CoverageLine
                          layer="Short-term"
                          summary={`${pct(row.stdBenefitPct)} ${durationLabel(row.stdDurationWeeks)}`}
                          cap={capLabel(row.stdMonthlyMax)}
                        />
                      )}
                      {coverage.longTerm !== null && (
                        <CoverageLine
                          layer="Long-term"
                          summary={`${pct(row.ltdBenefitPct)} ${benefitPeriodLabel(row)}`}
                          cap={capLabel(row.ltdMonthlyMax)}
                        />
                      )}
                      {warning !== null && (
                        <span
                          className={
                            warning.tone === "crit"
                              ? "rounded-md border border-crit/40 bg-crit/10 px-2 py-0.5 text-[11px] text-crit"
                              : "rounded-md border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn"
                          }
                        >
                          {warning.text}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="tabular py-2 text-right text-ink">{money.format(firstYear)}</td>
                  <td className="py-2 text-ink-2">{row.benefitTaxable ? "Taxable" : "Tax-free"}</td>
                  <td className="tabular py-2 text-right text-ink">
                    {canEdit ? (
                      <InlineAmount
                        mode="percent"
                        amount={Math.round(row.colaRate * 1000) / 10}
                        format={(n) => `${n}%`}
                        noun="annual increase"
                        label={row.name}
                        wrapperClassName="relative ml-auto w-[72px]"
                        onSave={(next) =>
                          savePolicyField(
                            row.id,
                            { colaRate: next / 100 },
                            { colaRate: next / 100 },
                          )
                        }
                      />
                    ) : (
                      pct(row.colaRate)
                    )}
                  </td>
                  <td className="tabular py-2 text-right text-ink">
                    {canEdit ? (
                      <span className="inline-flex items-center justify-end">
                        <InlineAmount
                          amount={row.annualPremium}
                          label={`${row.name} premium`}
                          onSave={(next) =>
                            savePolicyField(
                              row.id,
                              { annualPremium: next },
                              { annualPremium: next },
                            )
                          }
                        />
                        /yr
                      </span>
                    ) : (
                      `${money.format(row.annualPremium)}/yr`
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Edit ${row.name}`}
                        className="text-accent hover:underline"
                        onClick={() => {
                          setError(null);
                          setDialogState({ mode: "edit", policy: formToPolicy(row, row.id) });
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canEdit && dialogState !== null && (
        <DisabilityPolicyDialog
          {...dialogState}
          clientId={props.clientId}
          clientFirstName={props.clientFirstName}
          spouseFirstName={props.spouseFirstName}
          currentSalaryByPerson={props.currentSalaryByPerson}
          currentYear={props.currentYear}
          planStartYear={props.planStartYear}
          inflationRate={props.inflationRate}
          planEndYear={props.planEndYear}
          client={props.client}
          onClose={() => setDialogState(null)}
          onSaved={() => {
            setDialogState(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** The layer's summary and its cap are each a SINGLE text node, so the row
 *  reads as what the policy pays rather than as its stored fields. */
function CoverageLine({
  layer,
  summary,
  cap,
}: {
  layer: string;
  summary: string;
  cap: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{layer}</span>
      <span className="tabular text-ink">{summary}</span>
      <span className="tabular text-[11px] text-ink-3">{cap}</span>
    </div>
  );
}
