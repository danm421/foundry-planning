"use client";

import type { ClientData, DisabilityPolicy, ProjectionYear, StressTestKind } from "@/engine/types";
import type { ChangesPanelChange } from "@/components/scenario/changes-panel";
import {
  benefitForYear,
  resolveCoverage,
  resolveCoveredEarnings,
  type ResolvedCoverage,
} from "@/engine/disability-benefits";
import type { SolverMutation, SolverMutationKey, SolverPerson } from "@/lib/solver/types";
import { benefitPeriodText } from "@/lib/insurance-policies/disability-labels";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SolverSection } from "./solver-section";
import { LtcStressRow } from "./solver-stress-ltc-row";
import { StressTestRow, type StressScenarioContext } from "./solver-stress-test-row";
import {
  DollarField,
  OptionalYearField,
  PercentField,
  SelectField,
  YearField,
} from "./solver-stress-fields";

interface Props {
  baseClientData: ClientData;
  workingTree: ClientData;
  currentYear: number;
  clientName: string;
  spouseName: string;
  onChange: (m: SolverMutation) => void;
  onResetField: (keys: SolverMutationKey[]) => void;
  projectionYears: ProjectionYear[];
  clientId: string;
  scenarioId: string | null;
  scenarioName: string | null;
  savedLtcChange: ChangesPanelChange | null;
  onLtcSaved: () => void;
  onEditLtcOnChangesTab: (changeId: string) => void;
  /** Each kind's saved `stress_test` change in this scenario (on or off). */
  savedStressTests: Partial<Record<StressTestKind, ChangesPanelChange>>;
  onStressSaved: () => void;
}

const DEFAULT_SS_HAIRCUT_PCT = 0.23;
const DEFAULT_SS_HAIRCUT_YEAR = 2034;
const DEFAULT_CRASH_PCT = 0.3;
const DEFAULT_EXEMPTION_CAP = 7_000_000;
const DEFAULT_TAX_RATE_POINTS = 0.03;

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
  projectionYears,
  clientId,
  scenarioId,
  scenarioName,
  savedLtcChange,
  onLtcSaved,
  onEditLtcOnChangesTab,
  savedStressTests,
  onStressSaved,
}: Props) {
  const ps = workingTree.planSettings;
  const baseInflation = baseClientData.planSettings.inflationRate;
  const hasSpouse = Boolean(baseClientData.client.spouseDob);
  const defaultEventYear = currentYear + 1;

  // Flat mode has no bracket data to raise, so the control would be inert.
  // Disable it and say so rather than render something that looks live.
  // `taxEngineMode` is OPTIONAL and unset means flat (projection.ts routes on
  // `=== "bracket"`), so this must not be phrased as `!== "flat"`.
  const bracketMode = ps.taxEngineMode === "bracket";
  const capOn =
    (ps.lifetimeExemptionCap ?? null) !==
    (baseClientData.planSettings.lifetimeExemptionCap ?? null);

  // Every row's draft value is read off the working tree (the single source of
  // truth for drafts); a SAVED row reads the scenario's change list instead —
  // see StressTestRow.
  const stressCtx: StressScenarioContext = {
    clientId,
    scenarioId,
    scenarioName,
    client: workingTree.client,
    onChange,
    onResetField,
    onSaved: onStressSaved,
  };

  return (
    <SolverSection
      title="Stress Test"
      action={
        <FieldTooltip text="Toggle adverse assumptions to test plan resilience. Watch the Cash Flow chart and Plan Confidence react on the right. Stressors stack — turn on several at once to model a compound bad case." />
      }
    >
      {/* Inflation */}
      <StressTestRow
        kind="inflation"
        hint={`Grows living expenses at this rate instead of the plan's inflation assumption (currently ${pct(baseInflation)}). Other items — incomes, savings, taxes, insurance — are unaffected.`}
        draft={ps.livingExpenseInflationOverride != null ? { kind: "inflation", rate: ps.livingExpenseInflationOverride } : null}
        defaults={{ kind: "inflation", rate: roundRate(baseInflation + 0.02) }}
        saved={savedStressTests.inflation ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => (
          <PercentField label="Inflation rate" value={p.rate} onCommit={(rate) => commit({ ...p, rate })} />
        )}
      </StressTestRow>

      {/* Social Security haircut */}
      <StressTestRow
        kind="ss-haircut"
        hint="Reduces all Social Security benefits by a percentage starting in the chosen year (models a trust-fund shortfall)."
        draft={
          ps.ssBenefitHaircut
            ? { kind: "ss-haircut", pct: ps.ssBenefitHaircut.pct, startYear: ps.ssBenefitHaircut.startYear }
            : null
        }
        defaults={{ kind: "ss-haircut", pct: DEFAULT_SS_HAIRCUT_PCT, startYear: DEFAULT_SS_HAIRCUT_YEAR }}
        saved={savedStressTests["ss-haircut"] ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => (
          <div className="grid grid-cols-2 gap-x-5">
            <PercentField label="Benefit cut" value={p.pct} onCommit={(pct) => commit({ ...p, pct })} />
            <YearField label="Starting year" value={p.startYear} onCommit={(startYear) => commit({ ...p, startYear })} />
          </div>
        )}
      </StressTestRow>

      {/* Tax rates rise */}
      <StressTestRow
        kind="tax-rates"
        hint={
          bracketMode
            ? "Adds this many percentage points to each federal marginal rate above 0% from the chosen year — ordinary income, long-term gains and qualified dividends, and trust brackets. Bracket thresholds do not move. The alternative minimum tax, the 3.8% net investment income surtax, and state income tax are unaffected, so a client with large AMT or state exposure will see less than the full effect."
            : "Unavailable in flat tax mode — this plan has no tax brackets to raise. Switch the plan to the bracket tax engine to use it."
        }
        disabled={!bracketMode}
        draft={
          ps.taxRateStress
            ? { kind: "tax-rates", points: ps.taxRateStress.points, startYear: ps.taxRateStress.startYear }
            : null
        }
        defaults={{ kind: "tax-rates", points: DEFAULT_TAX_RATE_POINTS, startYear: defaultEventYear }}
        saved={savedStressTests["tax-rates"] ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => (
          <div className="grid grid-cols-2 gap-x-5">
            <PercentField
              // PercentField is uncontrolled, so it keeps displaying whatever was
              // typed. That only matters where the committed value can DIFFER
              // from it, and this is the one percent field that applies a CEILING
              // — type 25, blur, and the plan carries 20 while the box still
              // reads 25. (The component's own floor at zero cannot disagree with
              // the box, because the number input will not surrender a negative.)
              // Remounting on the committed value is the fix the disability
              // ending year already uses below.
              key={p.points}
              label="Rate increase"
              value={p.points}
              onCommit={(points) =>
                // Upper clamp only — PercentField's own onBlur already floors at
                // zero (Math.max(0, next) / 100) and the input carries min="0",
                // so a lower clamp here would be dead code.
                commit({ ...p, points: Math.min(points, MAX_RATE_STRESS_POINTS) })
              }
            />
            <YearField label="Starting year" value={p.startYear} onCommit={(startYear) => commit({ ...p, startYear })} />
          </div>
        )}
      </StressTestRow>

      {/* Disability */}
      <StressTestRow
        kind="disability"
        hint="Stops the person's salary and business income from the chosen year, and pays any disability policies they hold. Leave the ending year blank for a disability that never ends; fill it in to model a recovery — the paycheck picks back up the following year at the level it would have reached, the benefit stops, and any waived premium is billed again. Percentage-of-salary savings stop and restart automatically; flat-dollar contributions do not (adjust those manually)."
        draft={
          ps.disabilityEvent
            ? {
                kind: "disability",
                person: ps.disabilityEvent.person,
                startYear: ps.disabilityEvent.startYear,
                endYear: ps.disabilityEvent.endYear ?? null,
              }
            : null
        }
        defaults={{ kind: "disability", person: "client", startYear: defaultEventYear, endYear: null }}
        saved={savedStressTests.disability ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => (
          <>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              <SelectField
                label="Person"
                value={p.person}
                options={
                  hasSpouse
                    ? [
                        { value: "client", label: clientName },
                        { value: "spouse", label: spouseName },
                      ]
                    : [{ value: "client", label: clientName }]
                }
                onCommit={(person) => commit({ ...p, person: person as SolverPerson })}
              />
              <YearField
                label="Starting year"
                value={p.startYear}
                onCommit={(y) =>
                  commit({
                    ...p,
                    startYear: y,
                    // A disability cannot end before it begins. Pushing the start
                    // past the end drags the end along rather than leaving an
                    // inverted window, which reads to the engine as no disability
                    // at all — a lever that silently does nothing.
                    endYear: p.endYear == null ? null : Math.max(p.endYear, y),
                  })
                }
              />
              <OptionalYearField
                // The input is uncontrolled, so a year the CLAMP rewrote — either
                // handler can move the ending year — has to remount the field, or
                // the box keeps showing the rejected year while the readout beside
                // it reports the clamped one.
                key={p.endYear ?? "never"}
                label="Ending year"
                value={p.endYear}
                placeholder="Never"
                onCommit={(y) => commit({ ...p, endYear: y == null ? null : Math.max(y, p.startYear) })}
              />
            </div>
            <DisabilityCoverage
              tree={workingTree}
              person={p.person}
              startYear={p.startYear}
              endYear={p.endYear}
            />
          </>
        )}
      </StressTestRow>

      {/* Long-term care */}
      <LtcStressRow
        tree={workingTree}
        projectionYears={projectionYears}
        scenarioId={scenarioId}
        scenarioName={scenarioName}
        clientId={clientId}
        savedChange={savedLtcChange}
        onChange={onChange}
        onResetField={onResetField}
        onSaved={onLtcSaved}
        onEditOnChangesTab={onEditLtcOnChangesTab}
      />

      {/* Market crash */}
      <StressTestRow
        kind="market-crash"
        hint="One-time drawdown of investment balances (taxable, retirement, and 529s) in the chosen year. Cash, real estate, business, annuities, and life insurance are unaffected."
        draft={
          ps.marketShock
            ? { kind: "market-crash", year: ps.marketShock.year, drawdownPct: ps.marketShock.drawdownPct }
            : null
        }
        defaults={{ kind: "market-crash", year: defaultEventYear, drawdownPct: DEFAULT_CRASH_PCT }}
        saved={savedStressTests["market-crash"] ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => (
          <div className="grid grid-cols-2 gap-x-5">
            <PercentField label="Drawdown" value={p.drawdownPct} onCommit={(drawdownPct) => commit({ ...p, drawdownPct })} />
            <YearField label="Year" value={p.year} onCommit={(year) => commit({ ...p, year })} />
          </div>
        )}
      </StressTestRow>

      {/* Lifetime exemption cap */}
      <StressTestRow
        kind="exemption-cap"
        hint="Caps how high the federal estate/gift exemption grows. Above today's ~$15M it grows toward the cap then freezes; below $15M it freezes the exemption there for the whole plan. A lower cap raises estate tax."
        draft={capOn ? { kind: "exemption-cap", cap: ps.lifetimeExemptionCap ?? DEFAULT_EXEMPTION_CAP } : null}
        defaults={{ kind: "exemption-cap", cap: DEFAULT_EXEMPTION_CAP }}
        saved={savedStressTests["exemption-cap"] ?? null}
        ctx={stressCtx}
      >
        {(p, commit) => <DollarField label="Exemption cap" value={p.cap} onCommit={(cap) => commit({ ...p, cap })} />}
      </StressTestRow>
    </SolverSection>
  );
}

/** What the CONTRACT covers, as one sentence. Wording mirrors the Insurance
 *  page's disability rows so one policy does not read two different ways. */
function coverageSummary(policy: DisabilityPolicy): string {
  const layers: string[] = [];
  if (policy.shortTerm !== null) {
    layers.push(
      `${pct(policy.shortTerm.benefitPct)} for ${policy.shortTerm.durationWeeks} weeks`,
    );
  }
  if (policy.longTerm !== null) {
    layers.push(
      `${pct(policy.longTerm.benefitPct)} ${benefitPeriodText(policy.longTerm.benefitPeriod)}`,
    );
  }
  // The create/update schema rejects a policy with neither layer, so this is a
  // guard against a row that reached the tree some other way. An empty string
  // here would render a blank line that reads as coverage.
  if (layers.length === 0) return "No short-term or long-term coverage set";
  return layers.join(", then ");
}

/** At most one note per policy, most-blocking first — where "most blocking" is
 *  HOW MANY LAYERS the condition stops paying, not which reads worse.
 *
 *  The precedence and the SCOPE of each claim mirror `disability-panel.tsx` and
 *  `disability-coverage-timeline.tsx` exactly. Three surfaces must not tell the
 *  advisor three different stories about one policy, and
 *  `disability-panel.test.tsx` renders ALL THREE on the same fixtures to keep
 *  it that way. Change one of these functions and you must change the others.
 *
 *  This surface deliberately reports a SUBSET: the two conditions that stop a
 *  benefit being paid at all. A gap or an overlap between the layers is a
 *  shape the 233px lever pane cannot explain in the space it has, and the
 *  Insurance page says it properly. The cross-surface test encodes that as a
 *  subset, so the solver may stay silent but may never name a DIFFERENT
 *  condition from the other two. */
function coverageNote(c: ResolvedCoverage): string | null {
  if (c.coveredEarnings <= 0 && (c.shortTerm !== null || c.longTerm !== null)) {
    // FIRST because it kills BOTH layers, where a missing date of birth kills
    // only the long-term one. The two co-occur on an ordinary half-finished
    // onboarding (a spouse with neither), and reported the other way round the
    // advisor is told a date of birth fixes it, adds one, and the policy still
    // pays nothing — a remedy the data contradicts.
    //
    // Reachable, not theoretical: in salary mode `resolveCoveredEarnings`
    // returns 0 whenever the insured has no salary row in the disability year
    // (a non-earning spouse, or a disability set after the paycheck ends). The
    // summary above is built from the contract, so it reads as real cover next
    // to a $0 benefit unless we say why.
    return "No covered earnings on file, so this pays nothing.";
  }
  if (c.unresolved === "missing_dob") {
    // Scoped to the long-term layer deliberately: `resolveCoverage` builds the
    // short-term window from `policy.shortTerm` alone and never reads a date of
    // birth, so short-term still resolves and the projection still pays it — a
    // blanket "this policy pays nothing" would contradict the short-term half
    // of the summary rendered right above.
    return "No date of birth on file, so long-term coverage pays nothing.";
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
 * `tree.incomes` is the salary BEFORE the disability is applied.
 * `applyDisabilityEvent` runs inside the projection, never on the solver's
 * working tree, so the row the policy insures is still there. Reading suspended
 * incomes would yield $0 covered earnings and a benefit that looks present and
 * pays nothing.
 */
function DisabilityCoverage({
  tree,
  person,
  startYear,
  endYear,
}: {
  tree: ClientData;
  person: SolverPerson;
  startYear: number;
  /** Last disabled year, or null for a disability that never ends. */
  endYear: number | null;
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
      // Only meaningful when the disability ends — an open-ended one runs to the
      // plan horizon and a "total" would be a number about the plan's length,
      // not about the coverage.
      throughRecovery:
        endYear == null
          ? 0
          : sumBenefit(
              coverage,
              startYear,
              // The same horizon clamp `synthesizeDisabilityBenefits` applies:
              // a recovery year past the end of the plan cannot be credited
              // dollars the projection never runs long enough to pay.
              Math.min(endYear, planSettings.planEndYear),
              policy.colaRate,
            ),
    };
  });
  const total = resolved.reduce((sum, r) => sum + r.firstYear, 0);
  const totalThroughRecovery = resolved.reduce((sum, r) => sum + r.throughRecovery, 0);
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
        {endYear !== null && (
          <>
            , <span className="tabular text-ink">{money.format(totalThroughRecovery)}</span>{" "}
            through {endYear}
          </>
        )}
      </p>
    </div>
  );
}

/** Nominal dollars a policy pays across a bounded disability, start and end
 *  year inclusive. The same per-year function the projection pays on, summed —
 *  never a shortcut like `firstYear x years`, which would ignore the COLA, the
 *  elimination period, and a benefit period that runs out mid-window. */
function sumBenefit(
  coverage: ResolvedCoverage,
  startYear: number,
  endYear: number,
  colaRate: number,
): number {
  let total = 0;
  for (let year = startYear; year <= endYear; year++) {
    total += benefitForYear(coverage, startYear, year, colaRate);
  }
  return total;
}

/** decimal 0.6 -> "60%", without the 0.6 x 100 float drift. */
function pct(decimal: number): string {
  const p = Math.round(decimal * 1000) / 10;
  return `${p}%`;
}

/** Rounds a rate to the nearest 0.1% so the prefilled override reads cleanly. */
function roundRate(decimal: number): number {
  return Math.round(decimal * 1000) / 1000;
}
