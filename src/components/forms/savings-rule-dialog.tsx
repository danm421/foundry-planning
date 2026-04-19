"use client";

import { useState } from "react";
import GrowthSourceRadio from "./growth-source-radio";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import ScheduleTab from "@/components/schedule-tab";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { defaultSavingsRuleRefs, resolveMilestone } from "@/lib/milestones";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SavingsRuleAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
}

const EMPLOYER_MATCH_SUB_TYPES = new Set(["401k", "roth_401k", "403b", "roth_403b", "other"]);

export interface SavingsRuleRow {
  id: string;
  accountId: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  growthRate?: string | null;
  growthSource?: string | null;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  employerMatchAmount: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
}

export interface ClientInfoForDialog {
  milestones?: ClientMilestones;
  planStartYear?: number;
  planEndYear?: number;
}

export interface OwnerNamesForDialog {
  clientName: string;
  spouseName: string | null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

export const pctFromDecimal = (v: string | null | undefined, fallback: number): number => {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface SavingsRuleDialogProps {
  clientId: string;
  accounts: SavingsRuleAccount[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: SavingsRuleRow;
  onSaved: (rule: SavingsRuleRow, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  schedule?: { year: number; amount: number }[];
  clientInfo?: ClientInfoForDialog;
  ownerNames?: OwnerNamesForDialog;
  resolvedInflationRate: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SavingsRuleDialog({
  clientId,
  accounts,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
  clientInfo,
  ownerNames,
  resolvedInflationRate,
}: SavingsRuleDialogProps) {
  type SavTabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<SavTabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);
  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    editing?.growthSource === "inflation" ? "inflation" : "custom"
  );
  const [growthRateDisplay, setGrowthRateDisplay] = useState<string>(
    String(pctFromDecimal(editing?.growthRate ?? "0", 2))
  );
  const defaultRefs = defaultSavingsRuleRefs();
  const initialStartRef = (editing?.startYearRef as YearRef | null) ?? defaultRefs.startYearRef ?? null;
  const initialEndRef = (editing?.endYearRef as YearRef | null) ?? defaultRefs.endYearRef ?? null;
  const initialStartYear = editing?.startYear
    ?? (initialStartRef && clientInfo?.milestones ? resolveMilestone(initialStartRef, clientInfo.milestones) : null)
    ?? currentYear;
  const initialEndYear = editing?.endYear
    ?? (initialEndRef && clientInfo?.milestones ? resolveMilestone(initialEndRef, clientInfo.milestones) : null)
    ?? currentYear + 20;

  const [startYear, setStartYear] = useState<number>(initialStartYear);
  const [endYear, setEndYear] = useState<number>(initialEndYear);
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(initialStartRef);
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(initialEndRef);
  const srClientFirstName = ownerNames?.clientName?.split(" ")[0];
  const srSpouseFirstName = ownerNames?.spouseName?.split(" ")[0];

  const [accountId, setAccountId] = useState<string>(
    editing?.accountId ?? (accounts[0]?.id ?? "")
  );
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const showEmployerMatch =
    selectedAccount?.category === "retirement" &&
    EMPLOYER_MATCH_SUB_TYPES.has(selectedAccount?.subType ?? "");

  // Match mode: "none" | "percent" | "flat". Inferred from what's populated on the
  // rule being edited; defaults to "none" for new rules.
  type MatchMode = "none" | "percent" | "flat";
  const initialMatchMode: MatchMode = editing?.employerMatchAmount
    ? "flat"
    : editing?.employerMatchPct
    ? "percent"
    : "none";
  const [matchMode, setMatchMode] = useState<MatchMode>(initialMatchMode);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const matchPct = data.get("employerMatchPct") as string;
    const matchCap = data.get("employerMatchCap") as string;
    const matchAmount = data.get("employerMatchAmount") as string;
    const body = {
      accountId: data.get("accountId") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: String(startYear),
      endYear: String(endYear),
      startYearRef,
      endYearRef,
      growthRate: String(Number(growthRateDisplay) / 100),
      growthSource,
      employerMatchPct:
        showEmployerMatch && matchMode === "percent" && matchPct ? String(Number(matchPct) / 100) : null,
      employerMatchCap:
        showEmployerMatch && matchMode === "percent" && matchCap ? String(Number(matchCap) / 100) : null,
      employerMatchAmount: showEmployerMatch && matchMode === "flat" && matchAmount ? matchAmount : null,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/savings-rules/${editing!.id}`
        : `/api/clients/${clientId}/savings-rules`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save savings rule");
      }

      const saved = (await res.json()) as SavingsRuleRow;

      // On create: if a schedule was staged, persist it now that we have the ID.
      if (!isEdit && stagedSchedule.length > 0) {
        await fetch(`/api/clients/${clientId}/savings-rules/${saved.id}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: stagedSchedule }),
        });
      }

      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Savings Rule" : "Add Savings Rule"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="sr-account">
              Account <span className="text-red-500">*</span>
            </label>
            <select
              id="sr-account"
              name="accountId"
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="sr-amount">
                Annual Amount ($) <span className="text-red-500">*</span>
              </label>
              <CurrencyInput
                id="sr-amount"
                name="annualAmount"
                required
                defaultValue={editing?.annualAmount ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {hasSchedule && (
                <p className="mt-1 text-xs text-blue-400 cursor-pointer" onClick={() => setActiveTab("schedule")}>Using custom schedule</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300">Growth Rate</label>
              <div className="mt-1">
                <GrowthSourceRadio
                  value={growthSource}
                  customRate={growthRateDisplay}
                  resolvedInflationRate={resolvedInflationRate}
                  onChange={(next) => { setGrowthSource(next.value); setGrowthRateDisplay(next.customRate); }}
                />
              </div>
            </div>
            {showEmployerMatch && <div className="col-span-2 rounded-md border border-gray-800 bg-gray-900/60 p-3">
              <div className="mb-2 flex items-center gap-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Employer Match
                </span>
                <div className="flex gap-1 text-xs">
                  {(["none", "percent", "flat"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMatchMode(m)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        matchMode === m
                          ? "border-blue-600 bg-blue-900/40 text-blue-300"
                          : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
                      }`}
                    >
                      {m === "none" ? "None" : m === "percent" ? "% of salary" : "Flat $"}
                    </button>
                  ))}
                </div>
              </div>

              {matchMode === "percent" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-pct">
                      Match rate (%)
                    </label>
                    <PercentInput
                      id="sr-match-pct"
                      name="employerMatchPct"
                      placeholder="e.g., 50 or 3"
                      defaultValue={
                        editing?.employerMatchPct ? pctFromDecimal(editing.employerMatchPct, 0) : ""
                      }
                      className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-cap">
                      Cap (% of salary) — optional
                    </label>
                    <PercentInput
                      id="sr-match-cap"
                      name="employerMatchCap"
                      placeholder="e.g., 6"
                      defaultValue={
                        editing?.employerMatchCap ? pctFromDecimal(editing.employerMatchCap, 0) : ""
                      }
                      className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-gray-500">
                    No cap → <code>rate × account-owner salary</code>. With cap →{" "}
                    <code>rate × cap × salary</code> (e.g. 50% match up to 6% of salary).
                  </p>
                </div>
              )}

              {matchMode === "flat" && (
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-amt">
                    Flat annual amount ($)
                  </label>
                  <CurrencyInput
                    id="sr-match-amt"
                    name="employerMatchAmount"
                    placeholder="5000"
                    defaultValue={editing?.employerMatchAmount ?? ""}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    The employer deposits this flat amount each year, regardless of salary.
                  </p>
                </div>
              )}
            </div>}
            {clientInfo?.milestones ? (
              <MilestoneYearPicker
                name="startYear"
                id="sr-start"
                value={startYear}
                yearRef={startYearRef}
                milestones={clientInfo.milestones}
                onChange={(yr, ref) => {
                  setStartYear(yr);
                  setStartYearRef(ref);
                }}
                label="Start Year"
                clientFirstName={srClientFirstName}
                spouseFirstName={srSpouseFirstName}
              />
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="sr-start">
                  Start Year <span className="text-red-500">*</span>
                </label>
                <input
                  id="sr-start"
                  name="startYear"
                  type="number"
                  required
                  value={startYear}
                  onChange={(e) => {
                    setStartYear(Number(e.target.value));
                    setStartYearRef(null);
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
            {clientInfo?.milestones ? (
              <MilestoneYearPicker
                name="endYear"
                id="sr-end"
                value={endYear}
                yearRef={endYearRef}
                milestones={clientInfo.milestones}
                onChange={(yr, ref) => {
                  setEndYear(yr);
                  setEndYearRef(ref);
                }}
                label="End Year"
                clientFirstName={srClientFirstName}
                spouseFirstName={srSpouseFirstName}
                startYearForDuration={startYear}
              />
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="sr-end">
                  End Year <span className="text-red-500">*</span>
                </label>
                <input
                  id="sr-end"
                  name="endYear"
                  type="number"
                  required
                  value={endYear}
                  onChange={(e) => {
                    setEndYear(Number(e.target.value));
                    setEndYearRef(null);
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-between border-t border-gray-800 bg-gray-900 px-6 py-4">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Rule"}
            </button>
          </div>
        </form>)}

        {activeTab === "schedule" && (
          <ScheduleTab
            startYear={startYear}
            endYear={endYear}
            initialOverrides={stagedSchedule}
            onSave={async (overrides) => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/savings-rules/${editing.id}/schedule`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ overrides }),
                });
              }
              setStagedSchedule(overrides);
              setHasSchedule(overrides.length > 0);
            }}
            onClear={async () => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/savings-rules/${editing.id}/schedule`, { method: "DELETE" });
              }
              setStagedSchedule([]);
              setHasSchedule(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
