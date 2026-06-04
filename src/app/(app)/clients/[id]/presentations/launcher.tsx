"use client";

import { useState, useCallback } from "react";
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
import { TemplatesPanel } from "@/components/presentations/launcher/templates-panel";
import { SaveTemplateModal } from "@/components/presentations/launcher/save-template-modal";
import { AddPageButton } from "@/components/presentations/launcher/report-command-palette";
import {
  useLauncherState,
  type LauncherState,
  type LoadedTemplate,
} from "@/components/presentations/launcher/use-launcher-state";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import type { InvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";

interface Props {
  clientId: string;
  currentUserId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  initialTemplates: { shared: LoadedTemplate[]; mine: LoadedTemplate[] };
  investmentCatalog: InvestmentOptionCatalog;
}

function makeInitialState(): LauncherState {
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
  const [state, dispatch] = useLauncherState(makeInitialState());

  const [templates, setTemplates] = useState(props.initialTemplates);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  function handleLoadTemplate(id: string) {
    const all = [...templates.shared, ...templates.mine];
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

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/clients/${props.clientId}/presentations/export-pdf`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scenarioId: resolvedScenarioId,
            filename: state.filename || undefined,
            pages: descriptorsFor(state.pages),
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      a.download = match?.[1] ?? "presentation.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const generateDisabled = generating || state.pages.length === 0;
  const isLoadedTemplateMine =
    state.loadedTemplate?.createdByUserId === props.currentUserId;

  return (
    <PresentationOptionsProvider value={{ investmentCatalog: props.investmentCatalog, scenarios: props.scenarios, clientId: props.clientId }}>
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
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[16rem]">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
            Filename
          </span>
          <input
            type="text"
            value={state.filename}
            onChange={(e) =>
              dispatch({ type: "setFilename", value: e.target.value })
            }
            placeholder="(auto)"
            className="rounded border border-hair bg-card-2 px-2 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </label>
        <div className="flex items-center gap-2">
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
            onClick={() =>
              setPreviewRequest({
                title: "Full presentation",
                scenarioId: resolvedScenarioId,
                pages: descriptorsFor(state.pages),
              })
            }
            className="rounded border border-hair bg-card-2 px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-card-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Preview full
          </button>
          <button
            type="button"
            disabled={generateDisabled}
            onClick={handleGenerate}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate PDF"}
          </button>
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
                      onPreview={() =>
                        setPreviewRequest({
                          title: PRESENTATION_PAGES[p.pageId].title,
                          scenarioId: resolvedScenarioId,
                          pages: descriptorsFor([p]),
                        })
                      }
                      onDownload={async () => {
                        const pageTitle = PRESENTATION_PAGES[p.pageId].title;
                        const res = await fetch(
                          `/api/clients/${props.clientId}/presentations/export-pdf`,
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
                      }}
                      scenarios={props.scenarios}
                      snapshots={props.snapshots}
                    />
                  </SortableRow>
                ))}
              </SortableContext>
            </DndContext>
          )}
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
        </div>

        <div>
          <TemplatesPanel
            shared={templates.shared}
            mine={templates.mine}
            loadedTemplateId={state.loadedTemplate?.id ?? null}
            currentUserId={props.currentUserId}
            onLoad={handleLoadTemplate}
            onRename={handleRename}
            onChangeVisibility={handleChangeVisibility}
            onDelete={handleDelete}
            onSaveAsNew={() => setShowSaveModal(true)}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-crit" role="alert">
          {error}
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
