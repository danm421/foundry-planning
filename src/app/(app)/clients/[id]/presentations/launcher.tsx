"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import {
  PRESENTATION_PAGES,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { SelectedPageRow } from "@/components/presentations/launcher/selected-page-row";
import { PdfPreviewDialog, slug, type PreviewRequest } from "@/components/presentations/launcher/pdf-preview-dialog";
import type { RetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/types";
import type { ScenarioComparisonOptions } from "@/lib/presentations/pages/scenario-comparison/types";
import { TemplatesPanel } from "@/components/presentations/launcher/templates-panel";
import { SaveTemplateModal } from "@/components/presentations/launcher/save-template-modal";
import { AddPageButton } from "@/components/presentations/launcher/report-command-palette";
import {
  useLauncherState,
  type LauncherState,
  type LoadedTemplate,
} from "@/components/presentations/launcher/use-launcher-state";
import { useLauncherDraft } from "@/components/presentations/launcher/use-launcher-draft";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { RecentRunsPanel } from "@/components/presentations/recent-runs-panel";
import { useClientAccess } from "@/components/client-access-provider";
import type { InvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import type { EntityPickerOption } from "@/lib/presentations/entity-picker-options";
import type { ProposalOption } from "@/lib/presentations/investment-proposal-bundle";
import type { UnreviewedStoryPage } from "@/lib/presentations/story/export-gate";

interface Props {
  clientId: string;
  currentUserId: string;
  clientLastName: string;
  householdId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  initialTemplates: {
    shared: LoadedTemplate[];
    mine: LoadedTemplate[];
    builtIn: LoadedTemplate[];
    builtInHidden: LoadedTemplate[];
  };
  investmentCatalog: InvestmentOptionCatalog;
  entities?: EntityPickerOption[];
  proposals?: ProposalOption[];
}

/**
 * Default download name when the Filename field is left blank:
 * `Lastname_TemplateName_YYYY-MM-DD-HHmm.pdf`. Underscores delimit the three
 * segments, so any underscore/path/quote characters inside a segment are
 * folded to dashes; segments are capped to keep the whole name under the
 * export route's 120-char filename limit. Falls back to "Client" /
 * "Presentation" when the last name or loaded template is unavailable.
 */
function buildAutoFilename(
  lastName: string,
  templateName: string | undefined,
  now: Date,
): string {
  const sanitize = (s: string) =>
    s.replace(/[/\\:*?"<>|\r\n;_]+/g, "-").replace(/\s+/g, " ").trim();
  const last = sanitize(lastName).slice(0, 40) || "Client";
  const tpl = sanitize(templateName ?? "").slice(0, 50) || "Presentation";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${last}_${tpl}_${stamp}.pdf`;
}

/**
 * The soft export gate's warning (Task 16), appended to the run-progress
 * notice — the ONE production surface that both knows the count and fires
 * before the file exists. `runs/route.ts`'s 202 response is where
 * `storyReview` lives; the preview dialog (`pdf-preview-dialog.tsx`) fetches
 * `export-pdf` instead, which streams a PDF with no room for a JSON field, so
 * it was tried as a second surface and removed (Ruling T16-6) — this notice
 * is the only place an advisor sees this sentence.
 */
function unreviewedStoryWarning(storyReview: UnreviewedStoryPage[] | undefined): string {
  return (storyReview ?? [])
    .filter((p) => p.unreviewed > 0)
    .map((p) => `${p.unreviewed} of ${p.total} Plan Story chapters haven't been reviewed yet.`)
    .join(" ");
}

function makeInitialState(
  initialTemplates: Props["initialTemplates"],
): LauncherState {
  // Default the launcher to the "Foundation Plan" built-in starter so advisors
  // land on a ready-to-run deck instead of a bare cover/toc shell. Honor a
  // dismissal: if the advisor hid the built-in (it then lives in builtInHidden),
  // fall back to the minimal cover/toc/cashFlow deck below.
  const foundation = initialTemplates.builtIn.find(
    (t) => t.slug === "foundation-plan",
  );
  if (foundation) {
    return {
      topScenarioPickerValue: "base",
      filename: "",
      pages: foundation.pages.map((p) => ({
        pageId: p.pageId,
        options: p.options,
        scenarioOverride: undefined,
      })),
      loadedTemplate: foundation,
      isModified: false,
    };
  }
  return {
    topScenarioPickerValue: "base",
    filename: "",
    pages: [
      {
        pageId: "cover" as PresentationPageId,
        options: PRESENTATION_PAGES.cover.defaultOptions,
        scenarioOverride: undefined,
      },
      {
        pageId: "toc" as PresentationPageId,
        options: PRESENTATION_PAGES.toc.defaultOptions,
        scenarioOverride: undefined,
      },
      {
        pageId: "cashFlow" as PresentationPageId,
        options: PRESENTATION_PAGES.cashFlow.defaultOptions,
        scenarioOverride: undefined,
      },
    ],
    loadedTemplate: null,
    isModified: false,
  };
}

export function PresentationsLauncher(props: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const [state, dispatch] = useLauncherState(
    makeInitialState(props.initialTemplates),
  );
  // Restore/persist the in-progress deck per client+advisor so leaving and
  // returning to this tab brings it back exactly as they left it.
  useLauncherDraft(props.clientId, props.currentUserId, state, dispatch);

  // Pre-warm the compute cache for configured Retirement Comparison and
  // Scenario Comparison pages so the eventual "Generate PDF" hits a warm MC +
  // max-spend cache instead of running everything inline (the 800s-timeout
  // path). Each POST warms base + one scenario (warmComparisonCompute): 1
  // simulation + 1 solve per ref. Retirement Comparison's single comparison
  // scenario is 2 simulations + 2 solves. Scenario Comparison's default of
  // three chosen scenarios needs 4 DISTINCT computations (base + 3
  // scenarios) — 4 simulations + 4 solves — at minimum, not as a guarantee:
  // the loop below fires all three POSTs un-awaited, as separate route
  // invocations, and `singleFlight` (single-flight.ts) only coalesces calls
  // racing within the SAME process — it cannot dedupe two invocations that
  // both read the DB cache (cache-shell.ts) before either one's write lands.
  // If all three "base" reads beat all three writes, base recomputes three
  // times over, so actual work can run as high as 6 simulations + 6 solves.
  // Fire-and-forget, debounced, and de-duplicated per (scenarioId,target) for
  // this session — that dedup is on OUR requests, not on whether the compute
  // behind them raced. `targetPoS` is `null` when the page's own Max Spend
  // toggle is off — the registry already returns null max-spend refs in that
  // case (nothing reads the figure), so the warm POST skips that ~10s solve.
  const warmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keyOf = (t: { scenarioId: string; targetPoS: number | null }) =>
      `${t.scenarioId}:${t.targetPoS}`;
    const targets = state.pages
      .flatMap((p) => {
        if (p.pageId === "retirementComparison") {
          const o = p.options as RetirementComparisonOptions;
          const targetPoS = o.maxSpend?.show ? o.maxSpend?.targetConfidence ?? 0.85 : null;
          return o.scenarioId ? [{ scenarioId: o.scenarioId, targetPoS }] : [];
        }
        if (p.pageId === "scenarioComparison") {
          const o = p.options as ScenarioComparisonOptions;
          const targetPoS = o.maxSpend?.show ? o.maxSpend?.targetConfidence ?? 0.85 : null;
          return (o.scenarioIds ?? []).filter(Boolean).map((scenarioId) => ({ scenarioId, targetPoS }));
        }
        return [];
      })
      .filter((t) => !warmedRef.current.has(keyOf(t)));
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      for (const t of targets) {
        const key = keyOf(t);
        if (warmedRef.current.has(key)) continue;
        warmedRef.current.add(key);
        void fetch(`/api/clients/${props.clientId}/presentations/warm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(t),
        }).catch(() => {});
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [state.pages, props.clientId]);

  const [templates, setTemplates] = useState(props.initialTemplates);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Everything the 202 wants to warn about, in one region — the soft export
  // gate's unreviewed count (Task 16) and the Early Years flat-chart note both
  // ride that response and read as one "before you present this" line. Its own
  // state, not folded into `notice`'s string, so it can carry its own colour
  // (Minor 6: it must not read as part of the success message it sits beside).
  const [exportWarning, setExportWarning] = useState<string | null>(null);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over == null || active.id === over.id) return;
      const fromIdx = state.pages.findIndex(
        (_, i) => `row-${i}` === String(active.id),
      );
      const toIdx = state.pages.findIndex(
        (_, i) => `row-${i}` === String(over.id),
      );
      if (fromIdx >= 0 && toIdx >= 0)
        dispatch({ type: "reorder", from: fromIdx, to: toIdx });
    },
    [state.pages, dispatch],
  );

  async function refreshTemplates() {
    const res = await fetch("/api/presentation-templates");
    if (res.ok) setTemplates(await res.json());
  }

  async function handleSaveAsNew(input: {
    name: string;
    visibility: "shared" | "private";
  }) {
    const res = await fetch("/api/presentation-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        visibility: input.visibility,
        pages: state.pages.map((p) => ({
          pageId: p.pageId,
          options: p.options,
        })),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Save failed");
      return;
    }
    const created = await res.json();
    dispatch({
      type: "savedAs",
      template: {
        id: created.id,
        name: created.name,
        visibility: created.visibility,
        createdByUserId: created.createdByUserId,
        pages: created.pages,
      },
    });
    await refreshTemplates();
    setShowSaveModal(false);
  }

  async function handleUpdateLoaded() {
    if (!state.loadedTemplate) return;
    const res = await fetch(
      `/api/presentation-templates/${state.loadedTemplate.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pages: state.pages.map((p) => ({
            pageId: p.pageId,
            options: p.options,
          })),
        }),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Update failed");
      return;
    }
    const updated = await res.json();
    dispatch({
      type: "savedAs",
      template: { ...state.loadedTemplate, pages: updated.pages },
    });
    await refreshTemplates();
  }

  async function handleRename(id: string, newName: string) {
    await fetch(`/api/presentation-templates/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    await refreshTemplates();
  }

  async function handleChangeVisibility(
    id: string,
    v: "shared" | "private",
  ) {
    await fetch(`/api/presentation-templates/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: v }),
    });
    await refreshTemplates();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/presentation-templates/${id}`, { method: "DELETE" });
    if (state.loadedTemplate?.id === id) dispatch({ type: "clear" });
    await refreshTemplates();
  }

  async function handleDismissBuiltin(slug: string) {
    await fetch(`/api/presentation-templates/builtins/${slug}/dismiss`, {
      method: "POST",
    });
    if (state.loadedTemplate?.slug === slug) dispatch({ type: "clear" });
    await refreshTemplates();
  }

  async function handleRestoreBuiltin(slug: string) {
    await fetch(`/api/presentation-templates/builtins/${slug}/dismiss`, {
      method: "DELETE",
    });
    await refreshTemplates();
  }

  function handleLoadTemplate(id: string) {
    const all = [
      ...templates.shared,
      ...templates.mine,
      ...templates.builtIn,
      ...templates.builtInHidden,
    ];
    const t = all.find((x) => x.id === id);
    if (t) dispatch({ type: "loadTemplate", template: t });
  }

  const resolvedScenarioId =
    state.topScenarioPickerValue === "base" ? null : state.topScenarioPickerValue;

  // Human-readable name of the deck's scenario, shown in each page row's
  // "Default (…)" inline-picker option so advisors see what "default" inherits.
  const deckScenarioLabel =
    state.topScenarioPickerValue === "base"
      ? "Base case"
      : (props.scenarios.find((s) => s.id === state.topScenarioPickerValue)
          ?.name ??
        props.snapshots.find(
          (s) => `snap:${s.id}` === state.topScenarioPickerValue,
        )?.name ??
        state.topScenarioPickerValue);

  function descriptorsFor(pages: LauncherState["pages"]) {
    return pages.map((p) => ({
      pageId: p.pageId,
      options: p.options,
      scenarioOverride: p.scenarioOverride,
    }));
  }

  // Every comparison report carries its scenario selection in its own options
  // — the baseline is always Base Case. Unset, the sheet prints only a
  // placeholder, so name the offending rows and block the export until each
  // one is chosen. Two shapes of "unset" exist: the two-column pages (Plan /
  // Retirement / Tax) pick their scenario inline, and the four-column Scenario
  // Comparison page picks its list in its Options dialog and reports its own
  // unconfigured state via `isUnconfigured`.
  function pagesMissingTheirScenario(): Array<{
    title: string;
    position: number;
    viaOptions: boolean;
    hint: string | null;
  }> {
    return state.pages
      .map((p, i) => ({ page: PRESENTATION_PAGES[p.pageId], options: p.options, position: i + 1 }))
      .filter(({ page, options }) => {
        const inline = page.inlineScenarioOption;
        if (inline) return !inline.get(options as never);
        return page.isUnconfigured?.(options as never) ?? false;
      })
      // No inline picker means the row was caught by `isUnconfigured` — its
      // scenario list lives in the Options dialog, not an inline dropdown.
      .map(({ page, position }) => ({
        title: page.title,
        position,
        viaOptions: !page.inlineScenarioOption,
        hint: page.unconfiguredHint ?? null,
      }));
  }

  async function handleGenerate() {
    setError(null);
    setNotice(null);
    setExportWarning(null);
    // Require a comparison on every comparison page before exporting, otherwise
    // the PDF would ship empty placeholder slides. Name the offending page(s)
    // so the advisor knows which row to fix.
    const missingScenario = pagesMissingTheirScenario();
    if (missingScenario.length > 0) {
      const named = (list: typeof missingScenario) =>
        list.map((m) => `${m.title} (page ${m.position})`).join(", ");
      // Inline-picker pages (Plan / Retirement / Tax) get the original
      // wording; Scenario Comparison has no inline dropdown to point at, so
      // it's told to open its Options dialog instead.
      const inlinePages = missingScenario.filter((m) => !m.viaOptions);
      const optionsPages = missingScenario.filter((m) => m.viaOptions);
      const messages: string[] = [];
      if (inlinePages.length > 0) {
        const each = inlinePages.length > 1 ? " for each" : "";
        messages.push(
          `No comparison selected for ${named(inlinePages)}. Choose a comparison scenario${each} before generating the PDF.`,
        );
      }
      const hinted = optionsPages.filter((m) => m.hint);
      const generic = optionsPages.filter((m) => !m.hint);
      for (const m of hinted) {
        messages.push(`${m.title} (page ${m.position}): ${m.hint}`);
      }
      if (generic.length > 0) {
        const each = generic.length > 1 ? " for each" : "";
        messages.push(
          `No scenario chosen for ${named(generic)}. Open Options and choose at least one scenario${each} before generating the PDF.`,
        );
      }
      setError(messages.join(" "));
      return;
    }
    setGenerating(true);
    try {
      // The run is created immediately and the Retirement Comparison AI
      // commentary is generated server-side as the run's "Analyzing…" phase, so
      // the deck shows up in Recent runs right away instead of blocking here.
      const res = await fetch(
        `/api/clients/${props.clientId}/presentations/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId: resolvedScenarioId,
            filename:
              state.filename.trim() ||
              buildAutoFilename(
                props.clientLastName,
                state.loadedTemplate?.name,
                new Date(),
              ),
            pages: descriptorsFor(state.pages),
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // `storyReview` rides this same response on the async/202 path (see
      // `runs/route.ts`) — read here, before the file exists, which is the
      // soft gate's whole point: the export runs either way, and this is
      // just what makes the audit row the route also files an honest one.
      const body = (await res.json().catch(() => ({}))) as {
        storyReview?: UnreviewedStoryPage[];
        ladderWarning?: string | null;
      };
      setNotice("Generating your presentation — it'll appear in Recent runs.");
      setExportWarning(
        [unreviewedStoryWarning(body.storyReview), body.ladderWarning]
          .filter(Boolean)
          .join(" ") || null,
      );
      setRunsRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const generateDisabled = generating || state.pages.length === 0;
  const isLoadedTemplateMine =
    state.loadedTemplate?.createdByUserId === props.currentUserId;

  // Shown as the Filename placeholder so advisors see what "auto" produces.
  const autoFilename = buildAutoFilename(
    props.clientLastName,
    state.loadedTemplate?.name,
    new Date(),
  );

  return (
    <PresentationOptionsProvider value={{ investmentCatalog: props.investmentCatalog, scenarios: props.scenarios, clientId: props.clientId, entities: props.entities ?? [], proposals: props.proposals ?? [] }}>
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-ink mb-4">
        Presentations<span className="dot">.</span>
      </h1>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded border border-hair bg-card p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Scenario
          </span>
          <ScenarioPickerDropdown
            value={state.topScenarioPickerValue}
            onChange={(v) => dispatch({ type: "setTopScenario", value: v })}
            scenarios={props.scenarios}
            snapshots={props.snapshots}
            ariaLabel="Scenario for presentation"
          />
        </label>
        <label className="flex w-80 max-w-full flex-col gap-1 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Filename
          </span>
          <input
            type="text"
            value={state.filename}
            onChange={(e) =>
              dispatch({ type: "setFilename", value: e.target.value })
            }
            placeholder={autoFilename}
            title={`Leave blank to auto-name: ${autoFilename}`}
            className="rounded border border-hair bg-card-2 px-2 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </label>
        <AddPageButton
          counts={state.pages.reduce<Record<string, number>>((acc, p) => {
            acc[p.pageId] = (acc[p.pageId] ?? 0) + 1;
            return acc;
          }, {})}
          onAdd={(id) =>
            dispatch({
              type: "addPage",
              pageId: id,
              options: PRESENTATION_PAGES[id].defaultOptions,
            })
          }
        />
        <div className="ml-auto flex items-center gap-2">
          {state.loadedTemplate && state.isModified && isLoadedTemplateMine && (
            <button
              type="button"
              onClick={handleUpdateLoaded}
              className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
            >
              Update “{state.loadedTemplate.name}”
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSaveModal(true)}
            className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
          >
            Save as new…
          </button>
          <button
            type="button"
            disabled={state.pages.length === 0}
            onClick={() => {
              setPreviewRequest({
                title: "Full presentation",
                scenarioId: resolvedScenarioId,
                pages: descriptorsFor(state.pages),
              });
            }}
            className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-card-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Preview full
          </button>
          {canEdit && (
            <button
              type="button"
              disabled={generateDisabled}
              onClick={handleGenerate}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {state.pages.length === 0 ? (
            <div className="rounded border border-dashed border-hair-2 bg-card/40 p-6 text-center text-sm text-ink-3">
              Add a page to get started
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={state.pages.map((_, i) => `row-${i}`)}
                strategy={verticalListSortingStrategy}
              >
                {state.pages.map((p, i) => (
                  <SortableRow key={`row-${i}`} id={`row-${i}`}>
                    <SelectedPageRow
                      index={i}
                      pageId={p.pageId}
                      options={p.options}
                      scenarioOverride={p.scenarioOverride}
                      deckScenarioLabel={deckScenarioLabel}
                      onOptionsChange={(opts) =>
                        dispatch({
                          type: "updatePageOptions",
                          index: i,
                          options: opts,
                        })
                      }
                      onScenarioOverrideChange={(v) =>
                        dispatch({
                          type: "setScenarioOverride",
                          index: i,
                          value: v,
                        })
                      }
                      onRemove={() =>
                        dispatch({ type: "removePage", index: i })
                      }
                      onPreview={() => {
                        setPreviewRequest({
                          title: PRESENTATION_PAGES[p.pageId].title,
                          scenarioId: resolvedScenarioId,
                          pages: descriptorsFor([p]),
                        });
                      }}
                      onDownload={canEdit ? async () => {
                        const pageTitle = PRESENTATION_PAGES[p.pageId].title;
                        setError(null);
                        setNotice(null);
                        // download=1 → render synchronously (generating any
                        // Retirement Comparison AI commentary server-side first),
                        // stream the PDF back for a direct browser download, and
                        // persist a copy that also lands in Recent runs.
                        const res = await fetch(
                          `/api/clients/${props.clientId}/presentations/runs?download=1`,
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              scenarioId: resolvedScenarioId,
                              filename: `${slug(pageTitle)}.pdf`,
                              pages: descriptorsFor([p]),
                            }),
                          },
                        );
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          setError(j.error ?? `Download failed: HTTP ${res.status}`);
                          return;
                        }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${slug(pageTitle)}.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                        // The saved copy shows up under Recent runs.
                        setRunsRefreshKey((k) => k + 1);
                      } : undefined}
                      scenarios={props.scenarios}
                      snapshots={props.snapshots}
                    />
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="space-y-4">
          <RecentRunsPanel
            clientId={props.clientId}
            householdId={props.householdId}
            refreshKey={runsRefreshKey}
          />
          <TemplatesPanel
            shared={templates.shared}
            mine={templates.mine}
            builtIn={templates.builtIn}
            builtInHidden={templates.builtInHidden}
            loadedTemplateId={state.loadedTemplate?.id ?? null}
            currentUserId={props.currentUserId}
            onLoad={handleLoadTemplate}
            onRename={handleRename}
            onChangeVisibility={handleChangeVisibility}
            onDelete={handleDelete}
            onDismissBuiltin={handleDismissBuiltin}
            onRestoreBuiltin={handleRestoreBuiltin}
            onSaveAsNew={() => setShowSaveModal(true)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-crit" role="alert">
          {error}
        </p>
      )}
      {(notice || exportWarning) && (
        <p className="mt-3 text-sm" role="status">
          {/* Two colours in one status region, not two regions: this is the
              soft gate's warning (Minor 6) — it must not read as part of the
              success message it's appended beside, but it also isn't a
              second, separately-announced event. */}
          {notice && <span className="text-accent">{notice}</span>}
          {notice && exportWarning && " "}
          {exportWarning && <span className="text-warn">{exportWarning}</span>}
        </p>
      )}

      <SaveTemplateModal
        open={showSaveModal}
        initialName={state.loadedTemplate?.name ?? ""}
        initialVisibility={state.loadedTemplate?.visibility ?? "private"}
        onSave={handleSaveAsNew}
        onCancel={() => setShowSaveModal(false)}
      />
      <PdfPreviewDialog
        request={previewRequest}
        clientId={props.clientId}
        onClose={() => setPreviewRequest(null)}
      />
    </div>
    </PresentationOptionsProvider>
  );
}

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}
