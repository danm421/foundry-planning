"use client";

// "New report" trigger + dialog. Posts to the client-scoped reports
// API and navigates to the freshly created report on success. Uses the
// shared DialogShell footer pattern: the primary button submits the
// form by id (`form="new-report-form"`).
//
// When the user picks the `currentVsProposed` template, the dialog
// expands to include two scenario `<select>`s. Scenarios are fetched
// lazily from `GET /api/clients/[id]/scenarios` (same endpoint used by
// the scenario builder) the first time the dialog opens — keeps the
// list page render cheap when the dialog isn't used.

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";

type Template =
  | "blank"
  | "annualReview"
  | "retirementRoadmap"
  | "currentFinancialCondition"
  | "currentVsProposed";

type ScenarioOption = {
  id: string;
  name: string;
  isBaseCase: boolean;
};

const TEMPLATE_TITLES: Record<Template, string> = {
  blank: "Untitled report",
  annualReview: "Annual Review",
  retirementRoadmap: "Retirement Roadmap",
  currentFinancialCondition: "Current Financial Condition",
  currentVsProposed: "Plan Comparison",
};

export function NewReportButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<Template>("blank");
  const [title, setTitle] = useState(TEMPLATE_TITLES.blank);
  const [titleEdited, setTitleEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scenarios, setScenarios] = useState<ScenarioOption[] | null>(null);
  const [scenariosError, setScenariosError] = useState<string | null>(null);
  const [currentScenarioId, setCurrentScenarioId] = useState<string>("");
  const [proposedScenarioId, setProposedScenarioId] = useState<string>("");

  const router = useRouter();

  // Fetch scenarios the first time the dialog opens — keeps the list page
  // render cheap when nobody clicks "New report".
  useEffect(() => {
    if (!open || scenarios !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/scenarios`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: {
          scenarios: { id: string; name: string; isBaseCase: boolean }[];
        } = await res.json();
        if (cancelled) return;
        const opts = data.scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          isBaseCase: s.isBaseCase,
        }));
        setScenarios(opts);
        // Default Current to the base case if we can find one.
        const base = opts.find((s) => s.isBaseCase);
        if (base) setCurrentScenarioId((id) => id || base.id);
      } catch (err) {
        if (cancelled) return;
        setScenariosError(err instanceof Error ? err.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId, scenarios]);

  // Suggest a default title that tracks the chosen template — but stop
  // overriding the field once the user types something of their own.
  function handleTemplateChange(next: Template) {
    setTemplate(next);
    if (!titleEdited) setTitle(TEMPLATE_TITLES[next]);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: {
        template: Template;
        title: string;
        comparisonBinding?: {
          currentScenarioId: string;
          proposedScenarioId: string;
        };
      } = { template, title };
      if (template === "currentVsProposed") {
        if (!currentScenarioId || !proposedScenarioId) return;
        body.comparisonBinding = {
          currentScenarioId,
          proposedScenarioId,
        };
      }
      const res = await fetch(`/api/clients/${clientId}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { report } = await res.json();
      router.push(`/clients/${clientId}/reports/${report.id}`);
    } finally {
      setSaving(false);
    }
  }

  const needsScenarios = template === "currentVsProposed";
  const scenarioOptionsValid =
    !needsScenarios ||
    (currentScenarioId !== "" &&
      proposedScenarioId !== "" &&
      currentScenarioId !== proposedScenarioId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 px-4 rounded-md bg-accent text-paper font-medium text-[14px] hover:opacity-90"
      >
        New report
      </button>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        size="md"
        title="New report"
        primaryAction={{
          label: saving ? "Creating…" : "Create",
          form: "new-report-form",
          disabled: saving || !title || !scenarioOptionsValid,
        }}
      >
        <form id="new-report-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={fieldLabelClassName}>Template</label>
            <select
              className={selectClassName}
              value={template}
              onChange={(e) => handleTemplateChange(e.target.value as Template)}
            >
              <option value="blank">Blank</option>
              <option value="annualReview">Annual Review</option>
              <option value="retirementRoadmap">Retirement Roadmap</option>
              <option value="currentFinancialCondition">
                Current Financial Condition
              </option>
              <option value="currentVsProposed">
                Plan Comparison (Current vs. Proposed)
              </option>
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName}>Title</label>
            <input
              className={inputClassName}
              value={title}
              onChange={(e) => {
                setTitleEdited(true);
                setTitle(e.target.value);
              }}
              required
            />
          </div>

          {needsScenarios && (
            <div className="space-y-3 rounded-md border border-hair bg-card-2 p-3">
              <div className="text-[11px] font-mono text-ink-3 uppercase tracking-wider">
                Scenarios to compare
              </div>
              {scenariosError && (
                <div className="text-[12px] text-crit">
                  Couldn&rsquo;t load scenarios: {scenariosError}
                </div>
              )}
              {scenarios === null && !scenariosError && (
                <div className="text-[12px] font-mono text-ink-3">
                  Loading scenarios&hellip;
                </div>
              )}
              {scenarios !== null && scenarios.length < 2 && (
                <div className="text-[12px] text-crit">
                  This client needs at least two scenarios for a comparison
                  report. Create an alternative scenario in the scenario
                  builder first.
                </div>
              )}
              {scenarios !== null && scenarios.length >= 2 && (
                <>
                  <div>
                    <label className={fieldLabelClassName}>
                      Current scenario
                    </label>
                    <select
                      className={selectClassName}
                      value={currentScenarioId}
                      onChange={(e) => setCurrentScenarioId(e.target.value)}
                      required
                    >
                      <option value="">Select a scenario…</option>
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.isBaseCase ? " (base case)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={fieldLabelClassName}>
                      Proposed scenario
                    </label>
                    <select
                      className={selectClassName}
                      value={proposedScenarioId}
                      onChange={(e) => setProposedScenarioId(e.target.value)}
                      required
                    >
                      <option value="">Select a scenario…</option>
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.isBaseCase ? " (base case)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {currentScenarioId &&
                    proposedScenarioId &&
                    currentScenarioId === proposedScenarioId && (
                      <div className="text-[12px] text-crit">
                        Pick two different scenarios.
                      </div>
                    )}
                </>
              )}
            </div>
          )}
        </form>
      </DialogShell>
    </>
  );
}
