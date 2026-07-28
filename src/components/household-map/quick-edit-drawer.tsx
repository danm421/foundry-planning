"use client";

// Right-hand slide-over for a fast income/expense edit from the Household Map,
// per the Task 11 brief. Mirrors the existing overlay idiom (scrim + right
// panel + ref-counted body scroll lock — see transaction-drawer.tsx) rather
// than reusing IncomeDialog/ExpenseDialog: those two are private, non-exported
// components of income-expenses-view.tsx, and neither has ever exposed the
// "Show as a goal" toggle (isGoal has flowed engine-side since Task 10's goals
// board but this drawer is the first UI to write it).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { CurrencyInput } from "@/components/currency-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import GrowthSourceRadio from "@/components/forms/growth-source-radio";
import {
  coerceYearRef,
  defaultExpenseRefs,
  defaultIncomeRefs,
  resolveMilestone,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";
import type { MapColumn } from "@/lib/household-map/types";

export interface QuickEditTarget {
  kind: "income" | "expense";
  /** Existing item id to edit, or null to create a new one. */
  id: string | null;
  /** Column the "+ add" placeholder was clicked in. Only meaningful in create
   *  mode (id === null) — edit mode overwrites owner from the fetched row. */
  presetColumn: MapColumn;
}

/** The subset of the raw incomes/expenses list-GET row this drawer edits.
 *  Both endpoints return unenriched DB rows (drizzle camelCase columns), so
 *  this shape is a loose, defensive read — extra fields on the real row are
 *  ignored, not stripped. */
interface RawFlowRow {
  id: string;
  type: string;
  name: string;
  annualAmount: string | number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
  growthRate: string | number;
  growthSource: string | null;
  owner?: "client" | "spouse" | "joint"; // incomes only
  isGoal?: boolean | null; // expenses only
  isDefault?: boolean | null; // expenses only
}

function pctFromDecimal(v: string | number | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
}

/** `presetColumn` maps onto Income.owner for the two principal columns and
 *  "joint"; "tray" has no owner meaning here (entity-owned incomes don't route
 *  through this drawer's owner selector), so it falls back to "joint". */
function ownerFromColumn(column: MapColumn): "client" | "spouse" | "joint" {
  return column === "client" || column === "spouse" ? column : "joint";
}

interface QuickEditDrawerProps {
  clientId: string;
  target: QuickEditTarget;
  clientFirstName: string;
  spouseFirstName: string | null;
  /**
   * Approximate milestones for the Start/End picker's "at retirement" /
   * "at plan end" options. Built by the caller from data already in
   * `HouseholdMapProps` (no new fetch) — `planStart`/`clientEnd` are estimates
   * when the real values aren't available client-side. This is safe: a picked
   * milestone ref is stored alongside the resolved year, and the engine
   * re-resolves the effective year from the ref (not the stored year) on
   * every future load, so an approximate resolution here self-corrects on
   * the very next page refresh (which `useScenarioWriter` triggers on save).
   */
  milestones: ClientMilestones;
  onClose: () => void;
}

export default function QuickEditDrawer({
  clientId,
  target,
  clientFirstName,
  spouseFirstName,
  milestones,
  onClose,
}: QuickEditDrawerProps) {
  const writer = useScenarioWriter(clientId);
  const withScenario = useScenarioPreservingHref();
  useBodyScrollLock(true);

  const isEdit = target.id !== null;
  const collection = target.kind === "income" ? "incomes" : "expenses";

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [owner, setOwner] = useState<"client" | "spouse" | "joint">(
    ownerFromColumn(target.presetColumn),
  );
  const [annualAmount, setAnnualAmount] = useState("0");
  const [startYear, setStartYear] = useState(milestones.planStart);
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(null);
  const [endYear, setEndYear] = useState(milestones.planEnd);
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(null);
  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    target.kind === "income" ? "inflation" : "custom",
  );
  const [growthRateDisplay, setGrowthRateDisplay] = useState("3");
  const [isGoal, setIsGoal] = useState(false);
  const [type, setType] = useState<string>(target.kind === "income" ? "salary" : "other");
  const [isDefault, setIsDefault] = useState(false);

  // Seed create-mode defaults, or fetch the real row in edit mode. Keyed on
  // target.id/target.kind so a different card clicked while the drawer stays
  // open re-seeds rather than carrying over stale state.
  useEffect(() => {
    let cancelled = false;

    if (target.id === null) {
      const refs =
        target.kind === "income"
          ? defaultIncomeRefs("salary", ownerFromColumn(target.presetColumn))
          : defaultExpenseRefs("other");
      setName("");
      setOwner(ownerFromColumn(target.presetColumn));
      setAnnualAmount("0");
      setGrowthSource(target.kind === "income" ? "inflation" : "custom");
      setGrowthRateDisplay("3");
      setIsGoal(false);
      setIsDefault(false);
      setType(target.kind === "income" ? "salary" : "other");
      setStartYearRef(refs.startYearRef);
      setEndYearRef(refs.endYearRef);
      setStartYear(
        refs.startYearRef
          ? (resolveMilestone(refs.startYearRef, milestones, "start") ?? milestones.planStart)
          : milestones.planStart,
      );
      setEndYear(
        refs.endYearRef
          ? (resolveMilestone(refs.endYearRef, milestones, "end") ?? milestones.planEnd)
          : milestones.planEnd,
      );
      setLoading(false);
      setLoadError(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    fetch(`/api/clients/${clientId}/${target.kind === "income" ? "incomes" : "expenses"}`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json() as Promise<RawFlowRow[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((r) => r.id === target.id);
        if (!row) {
          setLoadError(true);
          return;
        }
        setName(row.name);
        if (target.kind === "income") setOwner(row.owner ?? "client");
        setAnnualAmount(String(row.annualAmount));
        setStartYear(row.startYear);
        setEndYear(row.endYear);
        setStartYearRef(coerceYearRef(row.startYearRef) ?? null);
        setEndYearRef(coerceYearRef(row.endYearRef) ?? null);
        setGrowthSource(row.growthSource === "inflation" ? "inflation" : "custom");
        setGrowthRateDisplay(String(pctFromDecimal(row.growthRate, 3)));
        setType(row.type);
        if (target.kind === "expense") {
          setIsGoal(row.type === "education" ? true : (row.isGoal ?? false));
          setIsDefault(row.isDefault ?? false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, target.kind, clientId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isEducation = target.kind === "expense" && type === "education";

  async function handleSave() {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      name,
      annualAmount,
      startYear: String(startYear),
      endYear: String(endYear),
      startYearRef,
      endYearRef,
      growthRate: String(Number(growthRateDisplay) / 100),
      growthSource,
      ...(target.kind === "income" ? { owner } : {}),
      ...(target.kind === "expense" ? { isGoal: isEducation ? true : isGoal } : {}),
    };
    if (!isEdit) body.type = type;

    const newId = isEdit
      ? target.id!
      : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `tmp-${Date.now()}`;
    const url = isEdit
      ? `/api/clients/${clientId}/${collection}/${target.id}`
      : `/api/clients/${clientId}/${collection}`;

    try {
      const res = await writer.submit(
        isEdit
          ? { op: "edit", targetKind: target.kind, targetId: target.id!, desiredFields: body }
          : { op: "add", targetKind: target.kind, entity: { id: newId, ...body } },
        { url, method: isEdit ? "PUT" : "POST", body },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await writer.submit(
        { op: "remove", targetKind: target.kind, targetId: target.id! },
        { url: `/api/clients/${clientId}/${collection}/${target.id}`, method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to delete");
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setSaving(false);
    }
  }

  const title = `${isEdit ? "Edit" : "Add"} ${target.kind === "income" ? "Income" : "Expense"}`;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close quick edit"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex h-full w-[420px] flex-col overflow-y-auto border-l border-hair bg-card p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink-2"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loadError ? (
          <p className="text-xs text-crit">Couldn&apos;t load this item.</p>
        ) : loading ? (
          <p className="text-xs text-ink-3">Loading…</p>
        ) : (
          <div className="flex flex-1 flex-col gap-4">
            {error && <p className="text-xs text-crit">{error}</p>}

            <div>
              <label className="block text-xs font-medium text-ink-2" htmlFor="qed-name">
                Name
              </label>
              <input
                id="qed-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-md border border-hair bg-card-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>

            {target.kind === "income" && (
              <div>
                <label className="block text-xs font-medium text-ink-2" htmlFor="qed-owner">
                  Owner
                </label>
                <select
                  id="qed-owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value as "client" | "spouse" | "joint")}
                  className="mt-1 block w-full rounded-md border border-hair bg-card-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  <option value="client">{clientFirstName || "Client"}</option>
                  {spouseFirstName && <option value="spouse">{spouseFirstName}</option>}
                  <option value="joint">Joint</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-2" htmlFor="qed-amount">
                Annual amount
              </label>
              <CurrencyInput id="qed-amount" value={annualAmount} onChange={setAnnualAmount} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MilestoneYearPicker
                name="qed-start"
                id="qed-start"
                label="Start"
                value={startYear}
                yearRef={startYearRef}
                milestones={milestones}
                position="start"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName ?? undefined}
                onChange={(y, ref) => {
                  setStartYear(y);
                  setStartYearRef(ref);
                }}
              />
              <MilestoneYearPicker
                name="qed-end"
                id="qed-end"
                label="End"
                value={endYear}
                yearRef={endYearRef}
                milestones={milestones}
                position="end"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName ?? undefined}
                onChange={(y, ref) => {
                  setEndYear(y);
                  setEndYearRef(ref);
                }}
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-ink-2">Growth</span>
              <div className="mt-1">
                <GrowthSourceRadio
                  value={growthSource}
                  customRate={growthRateDisplay}
                  // Display-only hint (matches GrowthSourceRadio's use everywhere
                  // else) — the engine re-resolves the actual inflation-sourced
                  // growth rate at load time, so an approximate constant here
                  // never gets persisted as the effective rate.
                  resolvedInflationRate={0.03}
                  onChange={({ value, customRate }) => {
                    setGrowthSource(value);
                    setGrowthRateDisplay(customRate);
                  }}
                />
              </div>
            </div>

            {target.kind === "expense" && (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={isEducation ? true : isGoal}
                  disabled={isEducation}
                  onChange={(e) => setIsGoal(e.target.checked)}
                />
                Show as a goal
                {isEducation && (
                  <span className="text-ink-3">— Education expenses are always goals</span>
                )}
              </label>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-hair pt-4">
              <Link
                href={withScenario(`/clients/${clientId}/details/income-expenses`)}
                className="text-xs text-accent hover:underline"
              >
                Open full editor →
              </Link>
              <div className="flex items-center gap-2">
                {isEdit && !isDefault && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-md border border-hair px-3 py-1.5 text-xs font-medium text-crit hover:bg-card-2"
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                  className="rounded-md border border-accent bg-accent-wash px-3 py-1.5 text-xs font-medium text-accent hover:bg-card-2"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
