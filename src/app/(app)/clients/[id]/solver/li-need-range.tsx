"use client";

// Life Insurance solver — need range.
//
// Presents each decedent's additional-coverage need as a RANGE: the
// straight-line solve is the lower bound, the Monte Carlo solve the upper
// bound. The straight-line result arrives automatically from the parent
// (`solveResult`); the Monte Carlo result is on-demand — the advisor sets a
// target success score and runs the solve from the LEFT input pane
// (`LiMcControl`), and its result (`mcResult`) lands here as the upper bound.
//
// Display only: one range card per decedent.
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { LiSolveCase, LiSolveResult } from "./solver-tab-life-insurance";
import type { McResultPayload, NeedMcResult } from "./use-li-mc-solve";

// Mirrors the solvers' coverage cap (see solve-need.ts / solve-need-mc.ts).
// Display-only — the engine is the source of truth for the actual bound.
const CAP_LABEL = "exceeds $20M";

interface Props {
  /** Straight-line solve — the range's lower bound (owned by the tab). */
  solveResult: LiSolveResult;
  /** Full current assumptions — supplies the death year + estate-tax toggle. */
  assumptions: LiAssumptions;
  /** Monte Carlo solve — the range's upper bound; null until the advisor runs it. */
  mcResult: McResultPayload | null;
  clientName: string;
  spouseName: string;
}

export function LiNeedRange({
  solveResult,
  assumptions,
  mcResult,
  clientName,
  spouseName,
}: Props) {
  const deathYear = assumptions.deathYear;

  return (
    /* One range card per decedent — all on one row. */
    <div
      className={`grid gap-3 ${
        solveResult.isMarried ? "sm:grid-cols-2" : "sm:grid-cols-1"
      }`}
    >
      <RangeCard
        name={clientName}
        deathYear={deathYear}
        straightLine={solveResult.client}
        mc={mcResult?.client ?? null}
        showEstateTaxes={assumptions.coverEstateTaxes}
      />
      {solveResult.isMarried && solveResult.spouse ? (
        <RangeCard
          name={spouseName}
          deathYear={deathYear}
          straightLine={solveResult.spouse}
          mc={mcResult?.spouse ?? null}
          showEstateTaxes={assumptions.coverEstateTaxes}
        />
      ) : null}
    </div>
  );
}

/**
 * One decedent's need card. The headline is a range: the straight-line solved
 * need (lower bound) → the Monte Carlo solved need (upper bound). The upper
 * bound is a muted placeholder until the advisor runs the MC solve.
 */
function RangeCard({
  name,
  deathYear,
  straightLine,
  mc,
  showEstateTaxes,
}: {
  name: string;
  deathYear: number;
  straightLine: LiSolveCase;
  mc: NeedMcResult | null;
  showEstateTaxes: boolean;
}) {
  const slExceedsCap = straightLine.status === "exceeds-cap";
  const slNeed = roundUpTo50k(straightLine.faceValue);
  const existing = straightLine.existingCoverageTotal;

  const mcExceedsCap = mc?.status === "exceeds-cap";
  const mcNeed = mc ? roundUpTo50k(mc.faceValue) : null;
  const mcScorePct = mc ? Math.round(mc.achievedScore * 1000) / 10 : null;

  // Upper bound of the range — a muted placeholder until the MC solve runs.
  const upperValue = !mc
    ? "—"
    : mcExceedsCap
      ? CAP_LABEL
      : formatCurrency(mcNeed ?? 0);
  const upperLabel = mc ? `Monte Carlo · ${mcScorePct}%` : "Run Monte Carlo";

  // Total recommended = additional need + existing coverage already in force.
  // Becomes a range once the MC upper bound has been solved. Only rendered
  // when the straight-line solve is within cap (see the JSX guard below).
  const totalLow = roundUpTo50k(slNeed + existing);
  const totalDisplay =
    mc && !mcExceedsCap
      ? `${formatCurrency(totalLow)} – ${formatCurrency(
          roundUpTo50k((mcNeed ?? 0) + existing),
        )}`
      : formatCurrency(totalLow);

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        If {name} dies in {deathYear}
      </div>

      {/* The need range — straight-line (low) → Monte Carlo (high). */}
      <div className="mt-2 flex items-start gap-3">
        <RangeEnd
          label="Straight-line"
          value={slExceedsCap ? CAP_LABEL : formatCurrency(slNeed)}
          warn={slExceedsCap}
          hint={{
            ariaLabel: "What is the straight-line solve?",
            text: "Coverage that funds the survivor's plan using fixed average market returns — no volatility. The lower bound of the need range.",
          }}
        />
        <svg
          viewBox="0 0 24 12"
          className="mt-1.5 h-3 w-6 shrink-0 text-ink-3"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1 6h21m0 0-5-4m5 4-5 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <RangeEnd
          label={upperLabel}
          value={upperValue}
          warn={mcExceedsCap}
          muted={!mc}
          hint={{
            ariaLabel: "What is the Monte Carlo solve?",
            text: "Coverage that hits your target plan confidence across many randomized market trials. Volatility-aware — the upper bound of the range. Run it from the Life Insurance input panel.",
          }}
        />
      </div>
      <div className="mt-2.5 text-[11px] text-ink-2">
        Additional life insurance needed
      </div>

      <div className="mt-3 border-t border-hair pt-2.5">
        {showEstateTaxes ? (
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 text-ink-2">
              Estate taxes
              <HelpHint
                ariaLabel="What do estate taxes include?"
                text="Federal + state estate tax plus income tax on IRD (retirement accounts inherited as income in respect of a decedent), summed across both deaths. Added to the coverage target."
              />
            </span>
            {/* Same addend lives on `mc.estateTaxAddend`; reading from `straightLine` because
             *  it is always populated (the MC solve may still be running). */}
            <span className="tabular text-ink-2">
              {formatCurrency(straightLine.estateTaxAddend)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-ink-2">Existing coverage in force</span>
          <span className="tabular text-ink-2">{formatCurrency(existing)}</span>
        </div>
        {straightLine.existingPolicies.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-3">
            None in force in {deathYear}.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {straightLine.existingPolicies.map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center justify-between text-[11px] text-ink-2"
              >
                <span>{p.name}</span>
                <span className="tabular">{formatCurrency(p.faceValue)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!slExceedsCap ? (
        <div className="mt-2.5 flex items-center justify-between border-t border-hair pt-2.5 text-[12px]">
          <span className="font-medium text-ink-2">
            Total recommended coverage
          </span>
          <span className="tabular font-semibold text-ink">{totalDisplay}</span>
        </div>
      ) : null}
    </div>
  );
}

/** One end of the range — a big tabular figure with a small caption beneath. */
function RangeEnd({
  label,
  value,
  warn,
  muted,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  muted?: boolean;
  hint?: { ariaLabel: string; text: string };
}) {
  return (
    <div>
      <div
        className={`text-[22px] font-semibold leading-none tabular tracking-tight ${
          warn ? "text-warn" : muted ? "text-ink-3" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
        <span>{label}</span>
        {hint ? <HelpHint ariaLabel={hint.ariaLabel} text={hint.text} /> : null}
      </div>
    </div>
  );
}

/**
 * A small "?" affordance beside a label — reveals supporting detail on hover
 * or keyboard focus. Tooltip is `pointer-events-none` so it never blocks the
 * controls it overlaps.
 */
function HelpHint({ ariaLabel, text }: { ariaLabel: string; text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-hair-2 text-[10px] font-semibold leading-none text-ink-3 transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-52 -translate-x-1/2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-ink-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
