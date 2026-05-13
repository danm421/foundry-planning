"use client";

import { useState } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";
import { describeChangeUnit, type ChangeUnit } from "@/lib/comparison/scenario-change-describe";

interface Props {
  plans: ComparisonPlan[];
  clientId: string;
}

type Panel = NonNullable<ComparisonPlan["panelData"]>;

function opBadge(opType: "add" | "edit" | "remove"): { sign: string; cls: string } {
  if (opType === "add") return { sign: "+", cls: "text-emerald-300 border-emerald-700" };
  if (opType === "remove") return { sign: "−", cls: "text-red-300 border-red-700" };
  return { sign: "~", cls: "text-amber-300 border-amber-700" };
}

function unitOp(unit: ChangeUnit): "add" | "edit" | "remove" {
  if (unit.kind === "single") return unit.change.opType;
  const ops = new Set(unit.changes.map((c) => c.opType));
  return ops.size === 1 ? unit.changes[0].opType : "edit";
}

function ChangeBox({ unit, targetNames, clientId, scenarioId }: { unit: ChangeUnit; targetNames: Record<string, string>; clientId: string; scenarioId: string }) {
  const [ai, setAi] = useState<{ status: "idle" | "loading" | "ready" | "error"; markdown?: string; error?: string }>({ status: "idle" });
  const title =
    unit.kind === "group"
      ? unit.groupName
      : (targetNames[`${unit.change.targetKind}:${unit.change.targetId}`] ?? `${unit.change.targetKind}`);
  const deterministic = describeChangeUnit(unit, targetNames);
  const text = ai.status === "ready" && ai.markdown ? ai.markdown : deterministic;
  const badge = opBadge(unitOp(unit));

  async function describeWithAI(force = false) {
    setAi({ status: "loading" });
    try {
      const res = await fetch(`/api/clients/${clientId}/comparison/describe-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId, unit, targetNames, force }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { markdown: string };
      setAi({ status: "ready", markdown: json.markdown });
    } catch (e) {
      setAi({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="rounded border border-slate-700 bg-slate-950/30 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] font-bold ${badge.cls}`} aria-hidden>
          {badge.sign}
        </span>
        <span className="font-semibold text-slate-100">{title}</span>
      </div>
      <p className="text-xs text-slate-300">{text}</p>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
        {ai.status === "ready" && (
          <button type="button" className="text-slate-400 underline" onClick={() => setAi({ status: "idle" })}>
            Reset
          </button>
        )}
        <button
          type="button"
          disabled={ai.status === "loading"}
          className="text-amber-300 hover:underline disabled:opacity-50"
          onClick={() => describeWithAI(ai.status === "ready")}
        >
          {ai.status === "loading" ? "Describing…" : ai.status === "ready" ? "Regenerate" : "Describe with AI"}
        </button>
      </div>
      {ai.status === "error" && <p className="mt-1 text-[11px] text-red-400">{ai.error}</p>}
    </div>
  );
}

function unitsFromPanel(panel: Panel): ChangeUnit[] {
  const groups = panel.toggleGroups;
  const grouped = new Map<string, Panel["changes"]>();
  for (const c of panel.changes) {
    if (c.toggleGroupId) {
      const arr = grouped.get(c.toggleGroupId) ?? [];
      arr.push(c);
      grouped.set(c.toggleGroupId, arr);
    }
  }
  const ungrouped = panel.changes.filter((c) => !c.toggleGroupId);

  const units: ChangeUnit[] = [];
  for (const g of groups) {
    const changes = grouped.get(g.id) ?? [];
    if (changes.length === 0) continue;
    units.push({ kind: "group", groupName: g.name, changes });
  }
  for (const c of ungrouped) {
    units.push({ kind: "single", change: c });
  }
  return units;
}

function PlanSection({ plan, clientId, index }: { plan: ComparisonPlan; clientId: string; index: number }) {
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      {plan.panelData == null ? (
        <p className="text-sm text-slate-400">No changes — this is the base plan.</p>
      ) : (
        (() => {
          const units = unitsFromPanel(plan.panelData);
          if (units.length === 0) {
            return <p className="text-sm text-slate-400">No changes recorded for this scenario.</p>;
          }
          return (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {units.map((u, idx) => (
                <ChangeBox
                  key={u.kind === "single" ? u.change.id : `g-${idx}`}
                  unit={u}
                  targetNames={plan.panelData!.targetNames}
                  clientId={clientId}
                  scenarioId={plan.panelData!.scenarioId}
                />
              ))}
            </div>
          );
        })()
      )}
    </div>
  );
}

export function ScenarioChangesComparisonSection({ plans, clientId }: Props) {
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Scenario Changes</h2>
      <div className="flex flex-col gap-4">
        {plans.map((p, i) => <PlanSection key={p.id} plan={p} clientId={clientId} index={i} />)}
      </div>
    </section>
  );
}
