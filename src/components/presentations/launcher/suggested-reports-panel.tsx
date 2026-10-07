"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  keepSlots,
  missingEssentials,
  pickSuggestions,
  type DeckPage,
  type ReportSuggestion,
} from "@/lib/presentations/suggestions/score-reports";

const SHOWN = 4;

const categoryOf = (id: PresentationPageId) => PRESENTATION_PAGES[id].category;

/** The page's defaults with the suggestion's own settings laid over them —
 *  e.g. the scenario that earned it. A patch the schema rejects is dropped
 *  rather than added half-valid. */
export function suggestedOptions(s: ReportSuggestion): unknown {
  const page = PRESENTATION_PAGES[s.pageId];
  if (!s.optionsPatch) return page.defaultOptions;
  const parsed = page.optionsSchema.safeParse({
    ...(page.defaultOptions as Record<string, unknown>),
    ...s.optionsPatch,
  });
  return parsed.success ? parsed.data : page.defaultOptions;
}

/** The plan an added (or previewed) suggestion should read. A page that
 *  follows the deck is pinned to the panel's plan when the two differ — the
 *  same per-page setting the row's own picker sets — so a card built on
 *  "New Plan" never prints Base Case. A page that carries its plan in its
 *  own settings (Roth Conversion, the comparisons, Plan Story) gets it there
 *  instead, and one fixed to Base Case is added as it is. */
export function suggestedOverride(
  pageId: PresentationPageId,
  options: unknown,
  plan: string,
  deckPlan: string,
): string | undefined {
  if (plan === deckPlan || !PRESENTATION_PAGES[pageId].supportsScenarioOverride) return undefined;
  const o = (options ?? {}) as Record<string, unknown>;
  return "scenarioId" in o || "scenarioIds" in o ? undefined : plan;
}

// Dollars, percents and years inside a reason print in the number face.
const FIGURE = /(\$[\d.,]+[kM]?|\d+(?:\.\d+)?%|\b(?:19|20)\d{2}(?:–(?:19|20)\d{2})?\b)/;

function Reason({ text }: { text: string }) {
  return (
    <>
      {text.split(FIGURE).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="tabular">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface Props {
  clientId: string;
  /** The deck's own plan — the panel follows it until the advisor picks one. */
  deckScenario: string;
  /** The deck's pages with their settings — a comparison page counts as the
   *  scenario's essential only when it points at that scenario. */
  deckPages: readonly DeckPage[];
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  onAdd: (pageId: PresentationPageId, options: unknown, scenarioOverride?: string) => void;
  onPreview: (pageId: PresentationPageId, options: unknown, scenarioOverride?: string) => void;
}

export function SuggestedReportsPanel(props: Props) {
  const [pickedPlan, setPickedPlan] = useState<string | null>(null);
  const plan = pickedPlan ?? props.deckScenario;
  // One answer per plan, kept for the visit: switching back is instant, and
  // the deck changing never asks again — the pick below re-runs locally.
  const [results, setResults] = useState<Record<string, ReportSuggestion[] | "error">>({});
  const entry = results[plan];
  const needsFetch = entry === undefined;

  useEffect(() => {
    if (!needsFetch) return;
    const ctrl = new AbortController();
    fetch(`/api/clients/${props.clientId}/presentations/suggestions?plan=${encodeURIComponent(plan)}`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { suggestions: ReportSuggestion[] };
        // A page id this build doesn't know (a stale deploy) can't be added.
        const known = body.suggestions.filter((s) => s.pageId in PRESENTATION_PAGES);
        setResults((r) => ({ ...r, [plan]: known }));
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setResults((r) => ({ ...r, [plan]: "error" }));
      });
    return () => ctrl.abort();
  }, [plan, props.clientId, needsFetch]);

  function retry() {
    setResults((r) => {
      const next = { ...r };
      delete next[plan];
      return next;
    });
  }

  const ready = Array.isArray(entry) ? entry : null;
  const inDeck = useMemo(() => new Set<string>(props.deckPages.map((p) => p.pageId)), [props.deckPages]);
  const best = useMemo(
    () => (ready ? pickSuggestions(ready, inDeck, categoryOf, SHOWN) : []),
    [ready, inDeck],
  );

  // Cards still suggested keep their slot across deck changes; a fresh plan
  // starts a fresh layout. Updated during render (React's "previous value"
  // pattern) so the first paint after an Add is already the settled layout.
  const [layout, setLayout] = useState<{ plan: string; ids: PresentationPageId[] }>({ plan, ids: [] });
  const shown = keepSlots(layout.plan === plan ? layout.ids : [], best);
  const shownIds = shown.map((s) => s.pageId);
  if (layout.plan !== plan || shownIds.join() !== layout.ids.join()) {
    setLayout({ plan, ids: shownIds });
  }
  const essentials = ready ? missingEssentials(ready, props.deckPages, plan, new Set(shownIds)) : [];

  function withPlan(s: ReportSuggestion, fn: Props["onAdd"]) {
    const options = suggestedOptions(s);
    fn(s.pageId, options, suggestedOverride(s.pageId, options, plan, props.deckScenario));
  }

  return (
    <section aria-labelledby="suggested-reports-heading" className="rounded border border-hair bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="suggested-reports-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Suggested reports
          <FieldTooltip text="Matched to the plan you choose. For a scenario, the pages that show what it changes, and how far it moves from Base Case, come first; then ages and retirement timing, accounts and debts, trusts, insurance, gifts, Roth conversions, projected estate tax and Medicare surcharges, and your saved proposals. Shows the four best matches not already in the deck — add one and the next-best takes its place. Below them, any essentials the deck is missing." />
        </h2>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          Based on
          <ScenarioPickerDropdown
            value={plan}
            onChange={setPickedPlan}
            scenarios={props.scenarios}
            snapshots={props.snapshots}
            ariaLabel="Plan to base suggestions on"
            className="w-[13rem] rounded border border-hair bg-paper px-2 py-1 text-xs text-ink-2 transition-colors hover:border-hair-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
      </div>

      <div aria-live="polite" aria-busy={needsFetch} className="grid gap-2 sm:grid-cols-2">
        {needsFetch ? (
          Array.from({ length: SHOWN }, (_, i) => (
            <div
              key={i}
              aria-hidden
              className="h-[7.5rem] animate-pulse rounded border border-hair bg-card-2 motion-reduce:animate-none"
            />
          ))
        ) : entry === "error" ? (
          <div className="col-span-full flex items-center justify-between gap-3 rounded border border-dashed border-hair-2 p-4 text-sm text-ink-3">
            <span>Couldn’t read this plan to suggest reports.</span>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-hair px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
            >
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="col-span-full rounded border border-dashed border-hair-2 p-4 text-sm text-ink-3">
            Every report this plan calls for is already in the deck.
          </p>
        ) : (
          shown.map((s) => {
            const page = PRESENTATION_PAGES[s.pageId];
            return (
              <article
                key={s.pageId}
                className="flex min-h-[7.5rem] flex-col gap-1 rounded border border-hair bg-card-2 p-3 transition-colors hover:border-hair-2"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{page.category}</span>
                <h3 className="text-sm font-medium text-ink">{page.title}</h3>
                <p className="flex-1 text-xs leading-relaxed text-ink-2">
                  <Reason text={s.reason} />
                </p>
                <div className="mt-1 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-label={`Preview ${page.title}`}
                    onClick={() => withPlan(s, props.onPreview)}
                    className="rounded px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-card-hover hover:text-ink"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-label={`Add ${page.title} to the deck`}
                    onClick={() => withPlan(s, props.onAdd)}
                    className="rounded border border-hair px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent-ink"
                  >
                    + Add
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {essentials.length > 0 && (
        <div
          role="group"
          aria-label="Missing from this deck"
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-hair pt-3 text-xs text-ink-3"
        >
          <span>Missing from this deck:</span>
          {essentials.map((s) => {
            const title = PRESENTATION_PAGES[s.pageId].title;
            return (
              <button
                key={s.pageId}
                type="button"
                aria-label={`Add ${title} to the deck`}
                title={s.reason}
                onClick={() => withPlan(s, props.onAdd)}
                className="rounded border border-hair px-2 py-0.5 text-ink-2 transition-colors hover:border-accent hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                + {title}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
