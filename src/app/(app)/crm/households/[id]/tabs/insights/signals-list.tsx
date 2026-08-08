"use client";

import type { Signal, SignalSeverity } from "@/lib/insights/signals";

/**
 * Group order. This mirrors `SEVERITY_RANK` in `@/lib/insights/signals/order`,
 * which has ALREADY sorted the incoming array. Grouping here is a `filter` per
 * severity, which preserves the given order within each group — the UI never
 * re-sorts, because `hashBattery` hashes the ordered list and a reorder here
 * would silently disagree with the hash the staleness flag is built on.
 */
const SEVERITY_ORDER: SignalSeverity[] = ["critical", "opportunity", "watch", "info"];

const SEVERITY_LABEL: Record<SignalSeverity, string> = {
  critical: "Needs attention",
  opportunity: "Opportunities",
  watch: "Worth watching",
  info: "Context",
};

/**
 * Matches the verdict-badge treatment already used by RiskAlignmentScale.
 *
 * Every token here is verified against `src/app/globals.css`: `crit`/`good`/
 * `warn`/`hair` are `--color-*` entries in the `@theme inline` block, and
 * `card-2` is the nested-surface token. The brief's `bg-surface-2` and
 * `text-ink-1` are NOT tokens — nothing defines `--color-surface-2` or
 * `--color-ink-1`, so those class names resolve to nothing at all (they appear
 * elsewhere in the repo and are silently dead there). `card-2` and `ink` are
 * the real equivalents.
 */
const SEVERITY_CLASS: Record<SignalSeverity, string> = {
  critical: "border-crit/40 bg-crit/10 text-crit",
  opportunity: "border-good/40 bg-good/10 text-good",
  watch: "border-warn/40 bg-warn/10 text-warn",
  info: "border-hair bg-card-2 text-ink-3",
};

/**
 * Every deterministic signal for the household, grouped by severity.
 *
 * Renders with zero AI spend and zero latency, so it has to read as complete on
 * its own — this is the part of the 360 tab that is useful before anyone clicks
 * Generate.
 */
export function SignalsList({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
        <h3 className="mb-1 text-sm font-semibold">Signals</h3>
        <p className="text-sm text-ink-3">
          Nothing needs attention on this household right now.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {SEVERITY_ORDER.map((severity) => {
        const group = signals.filter((s) => s.severity === severity);
        if (group.length === 0) return null;
        return (
          <section
            key={severity}
            className="rounded-[var(--radius)] border border-hair bg-card p-5"
          >
            <h3 className="mb-3 flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_CLASS[severity]}`}
              >
                {SEVERITY_LABEL[severity]}
              </span>
              <span className="tabular text-[11px] text-ink-3">{group.length}</span>
            </h3>
            <ul className="flex flex-col gap-3">
              {group.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{s.title}</span>
                  <span className="text-sm text-ink-2">{s.detail}</span>
                  {s.href && (
                    // Plain <a>, not next/link, on purpose: these deep-link into
                    // heavy routes (cashflow, monte-carlo) and a viewport-
                    // prefetching <Link> per signal would fire a burst of
                    // expensive server work just for opening the tab.
                    <a
                      href={s.href}
                      aria-label={`Open ${s.title}`}
                      className="w-fit rounded-[var(--radius-sm)] text-[12px] text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
