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

/** The delta is information, never applause. `neutral` covers "In line" but
 *  also "Differs" and "Not known", so it can never be green — a card exists
 *  because something is out of line. The chip's own words carry the meaning;
 *  colour only reinforces it. */
const TONE_CLASS: Record<Suggestion["delta"]["tone"], string> = {
  short: "border-warn/40 text-warn",
  missing: "border-warn/40 text-warn",
  over: "text-ink-2",
  extra: "text-ink-2",
  neutral: "text-ink-2",
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
  deduction: "deductions",
  entity: "net-worth",
  plan_settings: "assumptions",
  client: "family",
  medicare: "insurance",
};
const ROW_LABEL: Record<string, string> = {
  "income-expenses": "Inflows & Outflows",
  "net-worth": "Net Worth",
  deductions: "Deductions",
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
  const cleaned = amountText.replace(/[^0-9.]/g, "");
  // An empty box must not read as $0 — that would write a zero over a real row.
  const amount = cleaned === "" ? Number.NaN : Number(cleaned);
  const amountOk = !action?.amountEditable || (Number.isFinite(amount) && amount >= 0);

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
    <article aria-busy={busy !== null} className="rounded-lg border border-hair bg-card p-4">
      <p className="text-sm font-medium text-ink">{s.headline}</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
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
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Plan</span>
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
            disabled={isBusy}
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

              {!amountOk && <p className="text-xs text-warn">Enter an amount first.</p>}
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
            {/* R61: the reason a control is dead has to be readable without a
                mouse — a `title` is invisible to keyboard and screen readers. */}
            {dismissalsUnavailable && (
              <span className="text-xs text-ink-3">
                Setting cards aside isn&apos;t available yet.
              </span>
            )}
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
