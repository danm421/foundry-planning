"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerChoice, Reconciliation, Suggestion } from "@/lib/tax-reconciliation/types";
import { OverviewStrip } from "./overview-strip";
import { SuggestionSection } from "./suggestion-section";
import { FOCUS_RING, SuggestionCard, figureClass, rowLink, type CardBusy } from "./suggestion-card";

interface Summary {
  taxYear: number;
  status: "extracting" | "needs_review" | "ready" | "failed";
}

type Load =
  | { state: "idle" | "loading" }
  | { state: "ready"; bundle: Reconciliation }
  | { state: "error"; message: string };

/** One page-level announcement at a time, in a live region that is always in
 *  the DOM so a screen reader actually reads the change. */
type Notice = {
  tone: "success" | "info" | "error";
  text: string;
  link?: { href: string; label: string };
};

type Busy = { id: string; mode: Exclude<CardBusy, null> } | null;

interface Body {
  error?: string;
  message?: string;
  applied?: { suggestionId: string; summary: string };
  reconciliation?: Reconciliation;
}

/** R60: a Response body can only be read ONCE. Reading it twice — first to
 *  branch on the code, then again to build the message — throws on the second
 *  read, and every failure silently fell back to the generic sentence. Parse
 *  once, here, and pass the object to both branches. */
async function readBody(res: Response): Promise<Body> {
  return (await res.json().catch(() => ({}))) as Body;
}

/** Only `message` is advisor-facing. `error` carries machine codes — "stale",
 *  "no_plan", "dismissals_unavailable" — and this screen has to be
 *  client-presentable as it stands, so a code never reaches it. */
const sentence = (body: Body, fallback: string): string =>
  typeof body.message === "string" && body.message.trim() !== "" ? body.message : fallback;

const NOTICE_CLASS: Record<Notice["tone"], string> = {
  success: "border-good/40 bg-good/10 text-ink-2",
  info: "border-hair-2 bg-card text-ink-2",
  error: "border-crit/40 bg-crit/10 text-crit",
};

export function PlanVsReturnContent({
  clientId,
  initialYear,
  scenarioIgnored,
}: {
  clientId: string;
  initialYear?: number;
  scenarioIgnored: boolean;
}) {
  const [years, setYears] = useState<Summary[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [showInLine, setShowInLine] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  // Ruling 9: two clicks landing in the same tick would each recompute
  // server-side and each write. The disabled button covers the human case; this
  // covers the same-tick case, and it engages on the FIRST click, not on the
  // response.
  const writing = useRef(false);
  const base = `/api/clients/${clientId}/tax-returns`;

  useEffect(() => {
    let cancelled = false;
    fetch(base, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("The tax returns on file couldn't be loaded.");
        const body = (await res.json()) as { returns: Summary[] };
        if (cancelled) return;
        setYears(body.returns);
        const pick = body.returns.find((r) => r.taxYear === initialYear) ?? body.returns[0];
        if (pick) setYear(pick.taxYear);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoad({
            state: "error",
            message: e instanceof Error ? e.message : "The tax returns on file couldn't be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [base, initialYear]);

  const current = years?.find((r) => r.taxYear === year) ?? null;

  const loadBundle = useCallback(
    async (y: number) => {
      setLoad({ state: "loading" });
      try {
        const res = await fetch(`${base}/${y}/reconcile`, { cache: "no-store" });
        const body = await readBody(res);
        if (!res.ok || !body.reconciliation) {
          setLoad({
            state: "error",
            message: sentence(body, `The ${y} return couldn't be compared to the plan.`),
          });
          return;
        }
        setLoad({ state: "ready", bundle: body.reconciliation });
      } catch {
        setLoad({ state: "error", message: `The ${y} return couldn't be compared to the plan.` });
      }
    },
    [base],
  );

  useEffect(() => {
    if (year == null || current?.status !== "ready") return;
    setNotice(null);
    void loadBundle(year);
  }, [year, current?.status, loadBundle]);

  async function apply(s: Suggestion, amount?: number, owner?: OwnerChoice) {
    if (year == null || writing.current) return;
    writing.current = true;
    setBusy({ id: s.id, mode: "apply" });
    setNotice(null);
    try {
      const res = await fetch(`${base}/${year}/reconcile/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          suggestionId: s.id,
          ...(amount != null && Number.isFinite(amount) ? { amount } : {}),
          ...(owner ? { owner } : {}),
        }),
      });
      const body = await readBody(res);
      if (res.status === 409 && body.error === "stale") {
        if (body.reconciliation) setLoad({ state: "ready", bundle: body.reconciliation });
        else void loadBundle(year);
        setNotice({
          tone: "info",
          text: "The plan changed since this was suggested — here's the fresh list.",
        });
        return;
      }
      if (!res.ok || !body.reconciliation || !body.applied) {
        setNotice({
          tone: "error",
          text: sentence(body, "The update didn't apply, and nothing in the plan changed."),
        });
        return;
      }
      // R58: a successful apply closes the gap, so the card is gone from the
      // fresh bundle. The confirmation belongs to the page, not to a card that
      // no longer exists.
      setLoad({ state: "ready", bundle: body.reconciliation });
      setNotice({
        tone: "success",
        text: `Updated — ${body.applied.summary}`,
        link: rowLink(s, clientId),
      });
    } catch {
      setNotice({
        tone: "error",
        text: "The update didn't apply, and nothing in the plan changed.",
      });
    } finally {
      writing.current = false;
      setBusy(null);
    }
  }

  async function dismiss(id: string, mode: "dismiss" | "restore") {
    if (year == null || writing.current) return;
    writing.current = true;
    setBusy({ id, mode });
    setNotice(null);
    try {
      const res = await fetch(`${base}/${year}/reconcile/dismiss`, {
        method: mode === "dismiss" ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionId: id }),
      });
      const body = await readBody(res);
      if (!res.ok || !body.reconciliation) {
        setNotice({
          tone: "error",
          text:
            res.status === 503
              ? "Setting cards aside isn't available yet — the app needs its next update first."
              : sentence(
                  body,
                  mode === "dismiss"
                    ? "That card couldn't be set aside."
                    : "That card couldn't be restored.",
                ),
        });
        return;
      }
      setLoad({ state: "ready", bundle: body.reconciliation });
    } catch {
      setNotice({ tone: "error", text: "That card couldn't be updated." });
    } finally {
      writing.current = false;
      setBusy(null);
    }
  }

  const bundle = load.state === "ready" ? load.bundle : null;
  const ready = current?.status === "ready";

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">Plan vs. Return</h2>
        {year != null && (
          <p className="text-sm text-ink-3">
            What the {year} return says the plan should look like.
          </p>
        )}
        {scenarioIgnored && (
          <p className="text-xs text-ink-3">
            This screen compares the base case; the selected scenario is not applied here.
          </p>
        )}
      </header>

      {years === null && load.state !== "error" && (
        <p className="text-sm text-ink-3">Loading tax returns…</p>
      )}

      {years?.length === 0 && (
        <div className="rounded-lg border border-dashed border-hair bg-card p-12 text-center">
          <p className="text-ink-2">No tax return on file yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            Once a filed return is on file, this screen compares it against the base-case plan and
            offers one-click fixes for anything that has drifted.
          </p>
          <Link
            href={`/clients/${clientId}/details/tax-analysis`}
            className={`btn-ghost mt-4 inline-flex px-3 py-1.5 text-sm ${FOCUS_RING}`}
          >
            Upload a return on Tax Analysis
          </Link>
        </div>
      )}

      {years && years.length > 0 && (
        <div role="tablist" aria-label="Tax years" className="flex gap-1 border-b border-hair">
          {years.map((r) => (
            <button
              key={r.taxYear}
              type="button"
              role="tab"
              aria-selected={r.taxYear === year}
              className={`tabular px-3 py-2 text-sm ${FOCUS_RING} ${
                r.taxYear === year
                  ? "border-b-2 border-accent font-medium text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
              onClick={() => setYear(r.taxYear)}
            >
              {r.taxYear}
            </button>
          ))}
        </div>
      )}

      {/* Always mounted: a live region added at the same moment as its text is
          not reliably announced. */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {notice && (
          <p className={`rounded-md border px-3 py-2 text-sm ${NOTICE_CLASS[notice.tone]}`}>
            {notice.text}
            {notice.link && (
              <>
                {" · "}
                <Link href={notice.link.href} className={`underline ${FOCUS_RING}`}>
                  {notice.link.label}
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {current && !ready && (
        <div className="rounded-lg border border-hair bg-card p-8 text-center">
          <p className="text-ink-2">Finish reviewing the {current.taxYear} return first.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            A comparison is only as good as the figures behind it, so the return has to be confirmed
            before the plan is measured against it.
          </p>
          <Link
            href={`/clients/${clientId}/details/tax-analysis`}
            className={`btn-ghost mt-4 inline-flex px-3 py-1.5 text-sm ${FOCUS_RING}`}
          >
            Go to Tax Analysis
          </Link>
        </div>
      )}

      {ready && load.state === "loading" && (
        <p className="text-sm text-ink-3">Comparing the plan to the {year} return…</p>
      )}

      {load.state === "error" && (
        <div className="rounded-lg border border-hair bg-card p-8 text-center">
          <p className="text-ink-2">{load.message}</p>
        </div>
      )}

      {ready && bundle && (
        <>
          <OverviewStrip
            overview={bundle.overview}
            taxYear={bundle.taxYear}
            planYear={bundle.planYear}
          />

          {bundle.sections.map((s) => (
            <SuggestionSection key={s.id} title={s.title}>
              {s.items.map((item) => (
                <SuggestionCard
                  key={item.id}
                  suggestion={item}
                  taxYear={bundle.taxYear}
                  busy={busy?.id === item.id ? busy.mode : null}

                  locked={busy !== null}
                  dismissalsUnavailable={bundle.dismissalsUnavailable}
                  onApply={(amount, owner) => void apply(item, amount, owner)}
                  onDismiss={() => void dismiss(item.id, "dismiss")}
                  onRestore={() => void dismiss(item.id, "restore")}
                />
              ))}
            </SuggestionSection>
          ))}

          {bundle.sections.length === 0 && (
            <p className="rounded-lg border border-hair bg-card p-6 text-center text-sm text-ink-2">
              Nothing to update — the plan is in line with the {bundle.taxYear} return.
            </p>
          )}

          {bundle.notes.length > 0 && (
            <ul className="flex flex-col gap-1">
              {bundle.notes.map((n) => (
                <li key={n} className="text-xs text-ink-3">
                  {n}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-3 border-t border-hair pt-4">
            <button
              type="button"
              aria-expanded={showDismissed}
              className={`self-start rounded px-1 text-sm text-ink-2 underline hover:text-ink ${FOCUS_RING}`}
              onClick={() => setShowDismissed((v) => !v)}
            >
              Not applicable ({bundle.dismissed.length})
            </button>
            {showDismissed &&
              (bundle.dismissed.length === 0 ? (
                <p className="text-sm text-ink-3">Nothing has been set aside on this return.</p>
              ) : (
                bundle.dismissed.map((item) => (
                  <SuggestionCard
                    key={item.id}
                    suggestion={item}
                    taxYear={bundle.taxYear}
                    busy={busy?.id === item.id ? busy.mode : null}

                    locked={busy !== null}
                    dismissalsUnavailable={bundle.dismissalsUnavailable}
                    onApply={(amount, owner) => void apply(item, amount, owner)}
                    onDismiss={() => void dismiss(item.id, "dismiss")}
                    onRestore={() => void dismiss(item.id, "restore")}
                  />
                ))
              ))}

            <button
              type="button"
              aria-expanded={showInLine}
              className={`self-start rounded px-1 text-sm text-ink-2 underline hover:text-ink ${FOCUS_RING}`}
              onClick={() => setShowInLine((v) => !v)}
            >
              Already in line ({bundle.checks.length})
            </button>
            {showInLine &&
              (bundle.checks.length === 0 ? (
                <p className="text-sm text-ink-3">Nothing matched outright on this return.</p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Figures the plan already matches on the {bundle.taxYear} return
                  </caption>
                  <thead>
                    <tr className="border-b border-hair text-left text-ink-3">
                      <th className="py-1 font-normal">Check</th>
                      <th className="py-1 text-right font-normal">Return {bundle.taxYear}</th>
                      <th className="py-1 text-right font-normal">Plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.checks.map((c) => (
                      <tr key={c.id} className="border-t border-hair">
                        <td className="py-1 text-ink-2">{c.label}</td>
                        <td className={`py-1 text-right text-ink ${figureClass(c.returnDisplay)}`}>
                          {c.returnDisplay}
                        </td>
                        <td className={`py-1 text-right text-ink-2 ${figureClass(c.planDisplay)}`}>
                          {c.planDisplay}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
