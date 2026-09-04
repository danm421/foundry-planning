"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtUsd } from "@/lib/tax-analysis/format";
import { formatLineRefs } from "@/lib/tax-analysis/findings/line-refs";
import type { OwnerChoice, Suggestion } from "@/lib/tax-reconciliation/types";

/** Which write, if any, this card is waiting on. Null is idle. Kept as one
 *  discriminated prop rather than a boolean so the spinner lands on the button
 *  the advisor actually pressed — a shared boolean made "Not applicable" say
 *  "Applying…". */
export type CardBusy = "apply" | "dismiss" | "restore" | null;

/** The repo's focus ring (solver, dialogs). Not invented here — a keyboard user
 *  gets the same ring on this screen as on every other. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** Figures come through as pre-formatted strings and are not all numbers — a
 *  residence state and a filing status ride the same field. Mono is for
 *  numerals, so "Married filing jointly" must not get it. */
export const figureClass = (display: string): string => (/\d/.test(display) ? "tabular" : "");

/** The delta is information, never applause, and never a risk verdict.
 *
 *  All four measured tones share one weight. A plan running OVER is not the
 *  safe direction — on income it is the too-rosy one, on expenses and
 *  deductions it is the conservative one — so a single tone cannot encode
 *  risk direction and must not pretend to. `neutral` keeps the muted default
 *  `.chip`, because it is not "fine": it covers "Differs" and "Not known",
 *  the differences no number could be put on. Nothing here may read as
 *  success, and colour never carries the meaning alone — the chip's words do.
 *
 *  Every tone carries `chip-sentence`: `.chip` is a status-token style and
 *  forces uppercase at 0.1em, which would render "Plan is $15,000 short" as
 *  PLAN IS $15,000 SHORT on every card. A delta is a sentence.
 *
 *  These are `.chip-*` rules from globals.css, NOT Tailwind utilities.
 *  Tailwind emits utilities inside `@layer utilities` while `.chip` is
 *  unlayered, so an unlayered `.chip { color }` beats any `text-*` utility on
 *  the same element and a utility-based tone renders nothing at all.
 *  `keys every tone to a class that exists beside .chip` guards this. */
export const TONE_CLASS: Record<Suggestion["delta"]["tone"], string> = {
  short: "chip-sentence chip-drift",
  missing: "chip-sentence chip-drift",
  over: "chip-sentence chip-drift",
  extra: "chip-sentence chip-drift",
  neutral: "chip-sentence",
};

const OWNER_LABEL: Record<OwnerChoice, string> = {
  client: "Client",
  spouse: "Spouse",
  split: "Split evenly",
};

/** Where the row an action writes to is edited, keyed by the target kind's
 *  first segment. Labels match the sidebar's, so the confirmation names the
 *  screen the advisor will actually look for. */
const ROW_SCREEN: Record<string, string> = {
  income: "income-expenses",
  expense: "income-expenses",
  savings_rule: "net-worth",
  // NOT "deductions": that route is `LegacyDeductionsRedirect`, which forwards
  // to Assumptions. Linking there would land the advisor on a screen whose
  // name is not the one the link promised, and which is not in the sidebar.
  deduction: "assumptions",
  entity: "net-worth",
  plan_settings: "assumptions",
  client: "family",
  medicare: "insurance",
};
const ROW_LABEL: Record<string, string> = {
  "income-expenses": "Inflows & Outflows",
  "net-worth": "Net Worth",
  assumptions: "Assumptions",
  family: "Profile",
  insurance: "Insurance",
};

/** The "see what changed" link for a suggestion that was just applied.
 *  `clientId` is the route param, handed down from the page — never
 *  reverse-engineered out of `suggestion.link`, which most update-kind
 *  suggestions do not carry at all. */
export function rowLink(
  s: Suggestion,
  clientId: string,
): { href: string; label: string } | undefined {
  const slug = s.action ? ROW_SCREEN[s.action.target.kind.split(".")[0]] : undefined;
  return slug ? { href: `/clients/${clientId}/details/${slug}`, label: ROW_LABEL[slug] } : undefined;
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

export function SuggestionCard({
  suggestion: s,
  taxYear,
  busy,
  locked = false,
  dismissalsUnavailable,
  onApply,
  onDismiss,
  onRestore,
}: {
  suggestion: Suggestion;
  taxYear: number;
  busy: CardBusy;
  /** A write is in flight somewhere on the page. The page takes one write at a
   *  time, so every card's controls go dead — otherwise a click on a card that
   *  is not the busy one is silently swallowed with no feedback at all. */
  locked?: boolean;
  dismissalsUnavailable: boolean;
  onApply: (amount?: number, owner?: OwnerChoice) => void;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  const action = s.action;
  const [amountText, setAmountText] = useState(() =>
    action?.defaultAmount != null ? String(action.defaultAmount) : "",
  );
  const [owner, setOwner] = useState<OwnerChoice>(action?.ownerChoices?.[0] ?? "client");

  // `aria-busy` reports only THIS card's own write; `isBusy` gates the controls
  // and so also covers another card's write.
  const isBusy = busy !== null || locked;
  // The box is unsigned — but a LEADING minus survives the clean, and that is the
  // whole point. Stripping it made a negative `defaultAmount` initialise to its own
  // magnitude with no user action at all: the state read "-5000", cleaned to "5000",
  // relabelled the button "Set to $5,000", and the server's `amount >= 0` floor waved
  // the sign flip through. Kept, the sign fails `amountOk` and the card says so.
  // (The rules no longer mark a negative figure editable — `editableAmount` in
  // compare.ts — so this is the guard against a future one that does.) Any later
  // minus is dropped, so "5-0" is still 50 rather than NaN.
  const cleaned = amountText.replace(/[^0-9.-]/g, "").replace(/(?!^)-/g, "");
  // An empty box must not read as $0 — that would write a zero over a real row.
  const amount = cleaned === "" ? Number.NaN : Number(cleaned);
  const amountOk = !action?.amountEditable || (Number.isFinite(amount) && amount >= 0);
  // Two ways to be wrong, and "enter an amount first" is true of only one of them.
  const amountHint = cleaned === "" ? "Enter an amount first." : "Enter an amount of $0 or more.";

  // The button names the write it will actually perform, so an edited amount
  // has to reach the label too.
  const applyLabel =
    action == null
      ? ""
      : action.amountEditable &&
          action.defaultAmount != null &&
          Number.isFinite(amount) &&
          amount !== action.defaultAmount
        ? action.label.replace(fmtUsd(action.defaultAmount), fmtUsd(amount))
        : action.label;

  const refs = s.returnFigure.lineRefs.length ? formatLineRefs(s.returnFigure.lineRefs) : null;

  return (
    <article
      aria-busy={busy !== null}
      // A page can hold a dozen of these. Without a heading they are invisible
      // to heading navigation, and without a name the landmark is "article".
      aria-labelledby={`${s.id}-headline`}
      className="rounded-lg border border-hair bg-card p-4"
    >
      <h4 id={`${s.id}-headline`} className="text-sm font-medium text-ink">
        {s.headline}
      </h4>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="tabular text-[11px] uppercase tracking-[0.08em] text-ink-3">
            Return {taxYear}
          </span>
          <p className={`text-base text-ink ${figureClass(s.returnFigure.display)}`}>
            {s.returnFigure.display}
          </p>
          <p className="text-xs text-ink-3">
            {s.returnFigure.label}
            {refs ? ` · ${refs}` : ""}
          </p>
        </div>
        <div>
          {/* R69: the plan row's own year would label a figure already restated
              in tax-year dollars. The units are named once, on the strip. */}
          <span className="tabular text-[11px] uppercase tracking-[0.08em] text-ink-3">Plan</span>
          <p className={`text-base text-ink ${figureClass(s.planFigure.display)}`}>
            {s.planFigure.display}
          </p>
          <p className="text-xs text-ink-3">{s.planFigure.label}</p>
        </div>
      </div>

      <span className={`chip mt-3 ${TONE_CLASS[s.delta.tone]}`}>{s.delta.display}</span>
      <p className="mt-3 text-sm text-ink-2">{s.meaning}</p>

      {s.status === "dismissed" ? (
        <div className="mt-4">
          <button
            type="button"
            className={`btn-ghost px-3 py-1.5 text-sm disabled:opacity-50 ${FOCUS_RING}`}
            // Restore writes to the same store Dismiss does, so the same
            // outage takes it out. Largely unreachable — no store means no
            // dismissed cards to restore — but the gate belongs on both.
            disabled={isBusy || dismissalsUnavailable}
            onClick={onRestore}
          >
            {busy === "restore" ? (
              <>
                <Spinner />
                Restoring…
              </>
            ) : (
              "Restore"
            )}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {action && (
            <>
              {action.ownerChoices && (
                <fieldset className="flex flex-col gap-1" disabled={isBusy}>
                  <legend className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                    Whose
                  </legend>
                  <div className="flex gap-3">
                    {action.ownerChoices.map((o) => (
                      <label key={o} className="flex items-center gap-1.5 text-sm text-ink-2">
                        <input
                          type="radio"
                          name={`${s.id}-owner`}
                          className={`accent-[var(--color-accent)] ${FOCUS_RING}`}
                          checked={owner === o}
                          disabled={isBusy}
                          onChange={() => setOwner(o)}
                        />
                        {OWNER_LABEL[o]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {action.amountEditable && (
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  Amount
                  <input
                    className={`tabular w-36 rounded-md border border-hair bg-card-2 px-2 py-1.5 text-sm normal-case tracking-normal text-ink disabled:opacity-50 ${FOCUS_RING}`}
                    value={amountText}
                    inputMode="decimal"
                    disabled={isBusy}
                    aria-invalid={!amountOk}
                    onChange={(e) => setAmountText(e.target.value)}
                  />
                </label>
              )}

              <button
                type="button"
                className={`btn-primary px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${FOCUS_RING}`}
                disabled={isBusy || !amountOk}
                onClick={() =>
                  onApply(
                    action.amountEditable ? amount : undefined,
                    action.ownerChoices ? owner : undefined,
                  )
                }
              >
                {busy === "apply" ? (
                  <>
                    <Spinner />
                    Applying…
                  </>
                ) : (
                  applyLabel
                )}
              </button>

              {!amountOk && <p className="text-xs text-warn">{amountHint}</p>}
            </>
          )}

          {s.link && (
            <Link
              href={s.link.href}
              className={`btn-ghost px-3 py-1.5 text-sm ${FOCUS_RING}`}
            >
              {s.link.label}
            </Link>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* R61's visible reason lives ONCE, at page level: it is a
                page-wide state, and repeating it beside a dozen dead buttons
                shouted the same sentence a dozen times. */}
            <button
              type="button"
              className={`btn-ghost px-3 py-1.5 text-sm disabled:opacity-50 ${FOCUS_RING}`}
              disabled={isBusy || dismissalsUnavailable}
              onClick={onDismiss}
            >
              {busy === "dismiss" ? "Setting aside…" : "Not applicable"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
