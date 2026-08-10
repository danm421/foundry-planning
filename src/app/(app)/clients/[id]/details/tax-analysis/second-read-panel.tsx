"use client";

import { FieldTooltip } from "@/components/forms/field-tooltip";
import type { SecondRead, SecondReadItem } from "@/lib/tax-returns/second-read/types";

/** `Form 8283 · Section B · $28,500`, skipping whatever is absent, so an item
 *  with a form and no line never renders a dangling separator. */
function citation(item: SecondReadItem): string {
  return [item.form, item.line, item.quotedValue].filter(Boolean).join(" · ");
}

/**
 * The AI lane, sitting below the deterministic findings and deliberately
 * quieter than them: a dashed hairline container on a dimmer surface, the same
 * small uppercase section heading every other block uses, no severity grouping,
 * no entry in the findings index, and no impact figure. Nothing here is a
 * conclusion — every item is a transcription the advisor verifies against the
 * form (D12), which is why `citation` prints `quotedValue` as the string it is
 * and no numeric field exists to compute with.
 */
export function SecondReadPanel({
  secondRead,
  stale,
  busy,
  error,
  onGenerate,
  onDismiss,
}: {
  secondRead: SecondRead | null;
  stale: boolean;
  busy: boolean;
  /** Reported HERE rather than in the page-level banner: that banner is the
   *  first child of a page this panel sits at the foot of, so a failure shown
   *  there lands thousands of pixels above the button that produced it. */
  error: string | null;
  onGenerate: () => void;
  onDismiss: (itemId: string) => void;
}) {
  const visible = (secondRead?.items ?? []).filter((item) => !item.dismissed);

  return (
    <section
      aria-labelledby="second-read-heading"
      className="rounded border border-dashed border-hair bg-card/50 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* The tooltip trigger is a SIBLING of the heading, not a child: the
              section is named by this h3, and a nested button would append its
              "Show help" label to the region's accessible name. */}
          <div className="flex items-center gap-1.5">
            <h3 id="second-read-heading" className="text-sm font-medium uppercase text-ink-3">
              AI second read
            </h3>
            <FieldTooltip text="Runs only when you ask. It reads this year's attached files and reports at most six things it noticed that the rules above don't cover. It never calculates a figure — anything it quotes is copied straight off the form." />
          </div>
          <p className="mt-1 max-w-prose text-xs text-ink-3">
            Not calculated and not verified — check each item against the form before you
            act on it.
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-hair px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={onGenerate}
        >
          {secondRead ? "Run AI second read again" : "Run AI second read"}
        </button>
      </div>

      {/* Mounted unconditionally and empty when idle. A live region that is
          inserted into the DOM together with its text is announced
          unreliably — the region has to already be there for the change to
          register. `sr-only` keeps the idle node out of the layout. */}
      <p role="status" className={busy ? "mt-3 text-xs text-ink-3" : "sr-only"}>
        {busy ? "Reading the documents — this can take a minute…" : ""}
      </p>

      {error !== null && (
        <p role="alert" className="mt-3 rounded border border-crit bg-crit/10 p-2 text-xs text-crit">
          {error}
        </p>
      )}

      {stale && (
        <p className="mt-3 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-ink-2">
          The documents have changed since this read. Running it again clears any items
          you&apos;ve dismissed.
        </p>
      )}

      {secondRead && (
        <>
          {secondRead.warnings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {/* Index-keyed on purpose: two unreadable documents can produce
                  byte-identical warning text, and keying on the string would
                  drop one of the two lines. The list never reorders. */}
              {secondRead.warnings.map((w, i) => (
                <li key={i} className="text-xs text-warn">{w}</li>
              ))}
            </ul>
          )}

          {visible.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">
              The second read didn&apos;t find anything the rules above don&apos;t already cover.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {visible.map((item) => {
                const cite = citation(item);
                return (
                  <li key={item.id} className="rounded border border-hair bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block rounded-full border border-hair px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                          AI-read · unverified
                        </span>
                        <p className="mt-1 text-sm font-medium text-ink">{item.headline}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Dismiss ${item.headline}`}
                        className="-mr-1 shrink-0 px-1 py-1 text-xs text-ink-3 underline hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={busy}
                        onClick={() => onDismiss(item.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-ink-2">{item.detail}</p>
                    {/* One text node on purpose: the form reference and the value it
                        quotes are a single verbatim transcription, and mono says so. */}
                    {cite !== "" && <p className="tabular mt-2 text-xs text-ink-3">{cite}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
