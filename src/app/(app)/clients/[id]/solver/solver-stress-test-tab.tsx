"use client";

import { useState } from "react";

import type { ClientData, DisabilityPolicy } from "@/engine/types";
import {
  benefitForYear,
  resolveCoverage,
  resolveCoveredEarnings,
  type ResolvedCoverage,
} from "@/engine/disability-benefits";
import type { SolverMutation, SolverMutationKey, SolverPerson } from "@/lib/solver/types";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SolverSection } from "./solver-section";

interface Props {
  baseClientData: ClientData;
  workingTree: ClientData;
  currentYear: number;
  clientName: string;
  spouseName: string;
  onChange: (m: SolverMutation) => void;
  onResetField: (keys: SolverMutationKey[]) => void;
}

const DEFAULT_SS_HAIRCUT_PCT = 0.23;
const DEFAULT_SS_HAIRCUT_YEAR = 2034;
const DEFAULT_CRASH_PCT = 0.3;
const DEFAULT_EXEMPTION_CAP = 7_000_000;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function SolverStressTestTab({
  baseClientData,
  workingTree,
  currentYear,
  clientName,
  spouseName,
  onChange,
  onResetField,
}: Props) {
  const ps = workingTree.planSettings;
  const baseInflation = baseClientData.planSettings.inflationRate;
  const hasSpouse = Boolean(baseClientData.client.spouseDob);
  const defaultEventYear = currentYear + 1;

  // Derived on/off state — the working tree is the single source of truth.
  const inflationOn = ps.livingExpenseInflationOverride != null;
  const ssOn = ps.ssBenefitHaircut != null;
  const disabilityOn = ps.disabilityEvent != null;
  const crashOn = ps.marketShock != null;
  const capOn =
    (ps.lifetimeExemptionCap ?? null) !==
    (baseClientData.planSettings.lifetimeExemptionCap ?? null);

  return (
    <SolverSection
      title="Stress Test"
      action={
        <FieldTooltip text="Toggle adverse assumptions to test plan resilience. Watch the Cash Flow chart and Plan Confidence react on the right. Stressors stack — turn on several at once to model a compound bad case." />
      }
    >
      {/* Inflation */}
      <StressRow
        label="Higher inflation"
        hint={`Grows living expenses at this rate instead of the plan's inflation assumption (currently ${pct(baseInflation)}). Other items — incomes, savings, taxes, insurance — are unaffected.`}
        on={inflationOn}
        onToggle={(checked) =>
          checked
            ? onChange({ kind: "stress-inflation", rate: roundRate(baseInflation + 0.02) })
            : onResetField(["stress-inflation"])
        }
      >
        <PercentField
          label="Inflation rate"
          value={ps.livingExpenseInflationOverride ?? roundRate(baseInflation + 0.02)}
          onCommit={(rate) => onChange({ kind: "stress-inflation", rate })}
        />
      </StressRow>

      {/* Social Security haircut */}
      <StressRow
        label="Social Security cut"
        hint="Reduces all Social Security benefits by a percentage starting in the chosen year (models a trust-fund shortfall)."
        on={ssOn}
        onToggle={(checked) =>
          checked
            ? onChange({
                kind: "stress-ss-haircut",
                pct: DEFAULT_SS_HAIRCUT_PCT,
                startYear: DEFAULT_SS_HAIRCUT_YEAR,
              })
            : onResetField(["stress-ss-haircut"])
        }
      >
        <div className="grid grid-cols-2 gap-x-5">
          <PercentField
            label="Benefit cut"
            value={ps.ssBenefitHaircut?.pct ?? DEFAULT_SS_HAIRCUT_PCT}
            onCommit={(p) =>
              onChange({
                kind: "stress-ss-haircut",
                pct: p,
                startYear: ps.ssBenefitHaircut?.startYear ?? DEFAULT_SS_HAIRCUT_YEAR,
              })
            }
          />
          <YearField
            label="Starting year"
            value={ps.ssBenefitHaircut?.startYear ?? DEFAULT_SS_HAIRCUT_YEAR}
            onCommit={(y) =>
              onChange({
                kind: "stress-ss-haircut",
                pct: ps.ssBenefitHaircut?.pct ?? DEFAULT_SS_HAIRCUT_PCT,
                startYear: y,
              })
            }
          />
        </div>
      </StressRow>

      {/* Disability */}
      <StressRow
        label="Disability"
        hint="Stops the person's salary and business income from the chosen year forward, and pays any disability policies they hold. Percentage-of-salary savings stop automatically; flat-dollar contributions do not (adjust those manually)."
        on={disabilityOn}
        onToggle={(checked) =>
          checked
            ? onChange({ kind: "stress-disability", person: "client", startYear: defaultEventYear })
            : onResetField(["stress-disability"])
        }
      >
        <div className="grid grid-cols-2 gap-x-5">
          <SelectField
            label="Person"
            value={ps.disabilityEvent?.person ?? "client"}
            options={
              hasSpouse
                ? [
                    { value: "client", label: clientName },
                    { value: "spouse", label: spouseName },
                  ]
                : [{ value: "client", label: clientName }]
            }
            onCommit={(person) =>
              onChange({
                kind: "stress-disability",
                person: person as SolverPerson,
                startYear: ps.disabilityEvent?.startYear ?? defaultEventYear,
              })
            }
          />
          <YearField
            label="Starting year"
            value={ps.disabilityEvent?.startYear ?? defaultEventYear}
            onCommit={(y) =>
              onChange({
                kind: "stress-disability",
                person: ps.disabilityEvent?.person ?? "client",
                startYear: y,
              })
            }
          />
        </div>
        <DisabilityCoverage
          tree={workingTree}
          person={ps.disabilityEvent?.person ?? "client"}
          startYear={ps.disabilityEvent?.startYear ?? defaultEventYear}
        />
      </StressRow>

      {/* Market crash */}
      <StressRow
        label="Market crash"
        hint="One-time drawdown of investment balances (taxable, retirement, and 529s) in the chosen year. Cash, real estate, business, annuities, and life insurance are unaffected."
        on={crashOn}
        onToggle={(checked) =>
          checked
            ? onChange({ kind: "stress-market-crash", year: defaultEventYear, drawdownPct: DEFAULT_CRASH_PCT })
            : onResetField(["stress-market-crash"])
        }
      >
        <div className="grid grid-cols-2 gap-x-5">
          <PercentField
            label="Drawdown"
            value={ps.marketShock?.drawdownPct ?? DEFAULT_CRASH_PCT}
            onCommit={(p) =>
              onChange({
                kind: "stress-market-crash",
                year: ps.marketShock?.year ?? defaultEventYear,
                drawdownPct: p,
              })
            }
          />
          <YearField
            label="Year"
            value={ps.marketShock?.year ?? defaultEventYear}
            onCommit={(y) =>
              onChange({
                kind: "stress-market-crash",
                year: y,
                drawdownPct: ps.marketShock?.drawdownPct ?? DEFAULT_CRASH_PCT,
              })
            }
          />
        </div>
      </StressRow>

      {/* Lifetime exemption cap */}
      <StressRow
        label="Cap exemption growth"
        hint="Caps how high the federal estate/gift exemption grows. Above today's ~$15M it grows toward the cap then freezes; below $15M it freezes the exemption there for the whole plan. A lower cap raises estate tax."
        on={capOn}
        onToggle={(checked) =>
          checked
            ? onChange({ kind: "stress-exemption-cap", cap: DEFAULT_EXEMPTION_CAP })
            : onResetField(["stress-exemption-cap"])
        }
      >
        <DollarField
          label="Exemption cap"
          value={ps.lifetimeExemptionCap ?? DEFAULT_EXEMPTION_CAP}
          onCommit={(cap) => onChange({ kind: "stress-exemption-cap", cap })}
        />
      </StressRow>
    </SolverSection>
  );
}

/** A toggleable stressor block: checkbox + label + (when on) its parameter inputs. */
function StressRow({
  label,
  hint,
  on,
  onToggle,
  children,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-hair pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-[13px] font-medium text-ink">{label}</span>
        </label>
        <FieldTooltip text={hint} />
      </div>
      {on ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** decimal 0.6 -> "60%", without the 0.6 x 100 float drift. */
function pctLabel(d: number): string {
  return `${Math.round(d * 1000) / 10}%`;
}

function benefitPeriodLabel(
  period: NonNullable<DisabilityPolicy["longTerm"]>["benefitPeriod"],
): string {
  switch (period.mode) {
    case "to_age":
      return `to age ${period.age}`;
    case "to_ssnra":
      return "to Social Security full retirement age";
    case "years":
      return `for ${period.years} years`;
    case "lifetime":
      return "for life";
  }
}

/** What the CONTRACT covers, as one sentence. Wording mirrors the Insurance
 *  page's disability rows so one policy does not read two different ways. */
function coverageSummary(policy: DisabilityPolicy): string {
  const layers: string[] = [];
  if (policy.shortTerm !== null) {
    layers.push(
      `${pctLabel(policy.shortTerm.benefitPct)} for ${policy.shortTerm.durationWeeks} weeks`,
    );
  }
  if (policy.longTerm !== null) {
    layers.push(
      `${pctLabel(policy.longTerm.benefitPct)} ${benefitPeriodLabel(policy.longTerm.benefitPeriod)}`,
    );
  }
  // The create/update schema rejects a policy with neither layer, so this is a
  // guard against a row that reached the tree some other way. An empty string
  // here would render a blank line that reads as coverage.
  if (layers.length === 0) return "No short-term or long-term coverage set";
  return layers.join(", then ");
}

/** At most one note per policy, most-blocking first. The precedence and the
 *  SCOPE of each claim mirror `disability-panel.tsx` and
 *  `disability-coverage-timeline.tsx` — three surfaces must not tell the
 *  advisor three different stories about one policy. */
function coverageNote(c: ResolvedCoverage): string | null {
  if (c.unresolved === "missing_dob") {
    // Scoped to the long-term layer deliberately: `resolveCoverage` builds the
    // short-term window from `policy.shortTerm` alone and never reads a date of
    // birth, so short-term still resolves and the projection still pays it.
    return "No date of birth on file, so long-term coverage pays nothing.";
  }
  if (c.coveredEarnings <= 0 && (c.shortTerm !== null || c.longTerm !== null)) {
    // Reachable, not theoretical: in salary mode `resolveCoveredEarnings`
    // returns 0 whenever the insured has no salary row in the disability year
    // (a non-earning spouse, or a disability set after the paycheck ends). The
    // summary above is built from the contract, so it reads as real cover next
    // to a $0 benefit unless we say why.
    return "No covered earnings on file, so this pays nothing.";
  }
  return null;
}

/**
 * What the selected person is actually covered for, and what the plan pays them
 * in the first disability year.
 *
 * Every figure comes from `resolveCoveredEarnings` / `resolveCoverage` /
 * `benefitForYear` — the same three functions the projection pays on. Nothing
 * here re-derives a benefit from the policy's stored fields; a second
 * derivation on the UI side is how a screen and its engine drift apart.
 *
 * `tree.incomes` is the PRE-CLIP salary. `applyDisabilityEvent` runs inside the
 * projection, never on the solver's working tree, so the row the policy insures
 * is still there. Reading post-clip incomes would yield $0 covered earnings and
 * a benefit that looks present and pays nothing.
 */
function DisabilityCoverage({
  tree,
  person,
  startYear,
}: {
  tree: ClientData;
  person: SolverPerson;
  startYear: number;
}) {
  const policies = (tree.disabilityPolicies ?? []).filter((p) => p.insured === person);

  if (policies.length === 0) {
    return (
      <p className="mt-3 text-[12px] leading-snug text-ink-3">
        No disability coverage on file — this stops the income and pays no benefit.
      </p>
    );
  }

  const { planSettings, client } = tree;
  const resolved = policies.map((policy) => {
    const coveredEarnings = resolveCoveredEarnings(policy, {
      incomes: tree.incomes,
      client,
      startYear,
      planStartYear: planSettings.planStartYear,
      inflationRate: planSettings.inflationRate,
    });
    const coverage = resolveCoverage(
      policy,
      coveredEarnings,
      startYear,
      client,
      planSettings.planEndYear,
    );
    return {
      policy,
      coverage,
      firstYear: benefitForYear(coverage, startYear, startYear, policy.colaRate),
    };
  });
  const total = resolved.reduce((sum, r) => sum + r.firstYear, 0);
  // Named only when there is more than one, so the common single-policy case
  // stays two short lines in a pane that is about 35% of the viewport.
  const named = resolved.length > 1;

  return (
    <div className="mt-3 flex flex-col gap-1 text-[12px] leading-snug text-ink-2">
      {resolved.map(({ policy, coverage }) => {
        const note = coverageNote(coverage);
        return (
          <div key={policy.id} className="flex flex-col gap-1">
            <p>
              {named ? `${policy.name}: ${coverageSummary(policy)}` : coverageSummary(policy)}
            </p>
            {note !== null && <p className="text-crit">{note}</p>}
          </div>
        );
      })}
      <p>
        Pays <span className="tabular text-ink">{money.format(total)}</span> in {startYear}
      </p>
    </div>
  );
}

function PercentField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (decimal: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.5"
          min="0"
          defaultValue={Math.round(value * 1000) / 10}
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onCommit(Math.max(0, next) / 100);
          }}
          className="w-24 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums"
        />
        <span className="text-[12px] text-ink-3">%</span>
      </div>
    </label>
  );
}

function DollarField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (dollars: number) => void;
}) {
  const [text, setText] = useState(() => formatDollars(value));

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[12px] text-ink-3">$</span>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setText(digits === "" ? "" : formatDollars(Number(digits)));
          }}
          onBlur={() => {
            const next = Number(text.replace(/\D/g, ""));
            const dollars = Number.isFinite(next) ? Math.max(0, next) : 0;
            setText(formatDollars(dollars));
            onCommit(dollars);
          }}
          className="w-32 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums"
        />
      </div>
    </label>
  );
}

/** Whole-dollar value with thousand separators (no cents, no symbol). */
function formatDollars(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function YearField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (year: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <input
        type="number"
        step="1"
        defaultValue={value}
        onBlur={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onCommit(Math.round(next));
        }}
        className="w-24 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <select
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        className="w-full rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function pct(decimal: number): string {
  const p = Math.round(decimal * 1000) / 10;
  return `${p}%`;
}

/** Rounds a rate to the nearest 0.1% so the prefilled override reads cleanly. */
function roundRate(decimal: number): number {
  return Math.round(decimal * 1000) / 1000;
}
