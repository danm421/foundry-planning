"use client";

import type { ClientData } from "@/engine/types";
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
  const inflationOn = ps.inflationRate !== baseInflation;
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
        <FieldTooltip text="Toggle adverse assumptions to test plan resilience. Watch the Cash Flow chart and the Monte Carlo probability-of-success react on the right. Stressors stack — turn on several at once to model a compound bad case." />
      }
    >
      {/* Inflation */}
      <StressRow
        label="Higher inflation"
        hint={`Replaces the plan's inflation assumption (currently ${pct(baseInflation)}) for the whole projection.`}
        on={inflationOn}
        onToggle={(checked) =>
          checked
            ? onChange({ kind: "stress-inflation", rate: roundRate(baseInflation + 0.02) })
            : onResetField(["stress-inflation"])
        }
      >
        <PercentField
          label="Inflation rate"
          value={inflationOn ? ps.inflationRate : roundRate(baseInflation + 0.02)}
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
        hint="Stops the person's salary and business income from the chosen year forward. Percentage-of-salary savings stop automatically; flat-dollar contributions do not (adjust those manually)."
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
      </StressRow>

      {/* Market crash */}
      <StressRow
        label="Market crash"
        hint="One-time drawdown of investment balances (taxable + retirement) in the chosen year. Cash, real estate, and business are unaffected."
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
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-3">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-[12px] text-ink-3">$</span>
        <input
          type="number"
          step="100000"
          min="0"
          defaultValue={Math.round(value)}
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onCommit(Math.max(0, next));
          }}
          className="w-32 rounded border border-hair bg-card px-2 py-1 text-[13px] text-ink tabular-nums"
        />
      </div>
    </label>
  );
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
