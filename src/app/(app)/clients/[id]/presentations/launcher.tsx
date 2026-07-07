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

  // Pre-warm the compute cache for configured Retirement Comparison pages so the
  // eventual "Generate PDF" hits a warm MC + max-spend cache instead of running
  // ~4 simulations + 2 solves inline (the 800s-timeout path). Fire-and-forget,
  // debounced, and de-duplicated per (scenarioId,target) for this session.
  const warmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const targets = state.pages
      .filter((p) => p.pageId === "retirementComparison")
      .map((p) => p.options as { scenarioId?: string; maxSpend?: { targetConfidence?: number } })
      .filter((o): o is { scenarioId: string; maxSpend?: { targetConfidence?: number } } => !!o.scenarioId)
      .map((o) => ({ scenarioId: o.scenarioId, targetPoS: o.maxSpend?.targetConfidence ?? 0.85 }))
      .filter((t) => !warmedRef.current.has(`${t.scenarioId}:${t.targetPoS}`));
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      for (const t of targets) {
        const key = `${t.scenarioId}:${t.targetPoS}`;
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

  // Deck positions (1-based) of any Retirement Comparison page that has no
  // comparison scenario chosen. Such a page renders only a "Select a comparison
  // scenario" placeholder, so the export is blocked until each one is set.
  function retirementComparisonPagesMissingScenario(): number[] {
    return state.pages
      .map((p, i) => ({ p, position: i + 1 }))
      .filter(
        ({ p }) =>
          p.pageId === "retirementComparison" &&
          !(p.options as RetirementComparisonOptions).scenarioId,
      )
      .map(({ position }) => position);
  }

  async function handleGenerate() {
    setError(null);
    setNotice(null);
    // Require a comparison on every Retirement Comparison page before exporting,
    // otherwise the PDF would ship empty placeholder slides. Name the offending
    // page(s) so the advisor knows which row to fix.
    const missingComparison = retirementComparisonPagesMissingScenario();
    if (missingComparison.length > 0) {
      setError(
        missingComparison.length === 1
          ? `No comparison selected for the Retirement Comparison page (page ${missingComparison[0]}). Choose a comparison scenario before generating the PDF.`
          : `No comparison selected for Retirement Comparison pages ${missingComparison.join(", ")}. Choose a comparison scenario for each before generating the PDF.`,
      );
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
      setNotice("Generating your presentation — it'll appear in Recent runs.");
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
    <PresentationOptionsProvider value={{ investmentCatalog: props.investmentCatalog, scenarios: props.scenarios, clientId: props.clientId, entities: props.entities ?? [] }}>
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
      {notice && (
        <p className="mt-3 text-sm text-accent" role="status">
          {notice}
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
