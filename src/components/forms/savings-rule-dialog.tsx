"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import GrowthSourceRadio from "./growth-source-radio";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import ScheduleTab from "@/components/schedule-tab";
import { useTabAutoSave, type SaveResult } from "@/lib/use-tab-auto-save";
import TabAutoSaveIndicator from "@/components/tab-auto-save-indicator";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { defaultSavingsRuleRefs, resolveMilestone } from "@/lib/milestones";
import EmployerMatchFields, {
  type MatchMode,
  supportsEmployerMatch,
  inferMatchMode,
} from "./employer-match-fields";
import ContributionAmountFields, {
  type ContributionMode,
  supportsPercentContribution,
  supportsMaxContribution,
  supportsRothSplit,
  inferContributionMode,
} from "./contribution-amount-fields";
import DeductibleContributionCheckbox, {
  supportsDeductibility,
  defaultDeductibleForSubtype,
} from "./deductible-contribution-checkbox";
import ContributionCapCheckbox, {
  supportsContributionCap,
} from "./contribution-cap-checkbox";
import DialogShell from "@/components/dialog-shell";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SavingsRuleAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
}

export interface SavingsRuleRow {
  id: string;
  accountId: string;
  annualAmount: string;
  annualPercent?: string | null;
  isDeductible?: boolean;
  applyContributionLimit?: boolean;
  contributeMax?: boolean;
  startYear: number;
  endYear: number;
  growthRate?: string | null;
  growthSource?: string | null;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  employerMatchAmount: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  rothPercent?: string | null;
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SavTabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  // After an auto-save in create mode, effectiveRuleId routes subsequent
  // saves through PUT. We can't mutate `editing` (it's a prop) so we track
  // the promoted id separately.
  const [effectiveRuleId, setEffectiveRuleId] = useState<string | null>(editing?.id ?? null);
  const isEdit = effectiveRuleId !== null;
  const writer = useScenarioWriter(clientId);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const autoSavedRef = useRef(false);
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
    ?? (initialStartRef && clientInfo?.milestones ? resolveMilestone(initialStartRef, clientInfo.milestones, "start") : null)
    ?? currentYear;
  const initialEndYear = editing?.endYear
    ?? (initialEndRef && clientInfo?.milestones ? resolveMilestone(initialEndRef, clientInfo.milestones, "end") : null)
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
  const showEmployerMatch = supportsEmployerMatch(
    selectedAccount?.category,
    selectedAccount?.subType
  );
  const showContributionModeToggle = supportsPercentContribution(
    selectedAccount?.category,
    selectedAccount?.subType
  );
  const showMaxToggle = supportsMaxContribution(
    selectedAccount?.category,
    selectedAccount?.subType
  );
  const showDeductibleCheckbox = supportsDeductibility(
    selectedAccount?.category,
    selectedAccount?.subType
  );
  const showRothSplit = supportsRothSplit(
    selectedAccount?.category,
    selectedAccount?.subType
  );

  const initialMatchMode: MatchMode = inferMatchMode(
    editing?.employerMatchAmount,
    editing?.employerMatchPct
  );
  const [matchMode, setMatchMode] = useState<MatchMode>(initialMatchMode);

  const initialContribMode: ContributionMode = inferContributionMode(
    editing?.annualPercent ?? null,
    editing?.contributeMax ?? null,
  );
  const [contribMode, setContribMode] = useState<ContributionMode>(initialContribMode);

  const [isDeductible, setIsDeductible] = useState<boolean>(
    editing?.isDeductible ?? defaultDeductibleForSubtype(selectedAccount?.subType)
  );

  const showContributionCapCheckbox = supportsContributionCap(
    selectedAccount?.category,
    selectedAccount?.subType
  );
  const [applyContributionLimit, setApplyContributionLimit] = useState<boolean>(
    editing?.applyContributionLimit ?? true
  );

  // Build the request body from form state + FormData. Shared by explicit
  // submit and auto-save-on-tab-switch.
  function buildBody(formEl: HTMLFormElement) {
    const data = new FormData(formEl);
    const matchPct = data.get("employerMatchPct") as string;
    const matchCap = data.get("employerMatchCap") as string;
    const matchAmount = data.get("employerMatchAmount") as string;
    const annualAmountInput = data.get("annualAmount") as string;
    const annualPercentInput = data.get("annualPercent") as string;

    const pretaxAmount = Number(data.get("pretaxAmount") ?? 0);
    const rothAmount = Number(data.get("rothAmount") ?? 0);
    const pretaxPercentInput = Number(data.get("pretaxPercent") ?? 0);
    const rothPercentInput = Number(data.get("rothPercentInput") ?? 0);
    const rothShareOfMax = Number(data.get("rothShareOfMax") ?? 0);

    // Defaults cover max-mode and non-401(k)/403(b) accounts; the split
    // branches below override for amount/percent split modes.
    let outAnnualAmount: string =
      contribMode === "amount" ? annualAmountInput : (editing?.annualAmount ?? "0");
    let outAnnualPercent: string | null =
      contribMode === "percent" && annualPercentInput
        ? String(Number(annualPercentInput) / 100)
        : null;
    let outRothPercent: string | null = null;

    if (showRothSplit && !hasSchedule && contribMode === "amount") {
      const total = pretaxAmount + rothAmount;
      outAnnualAmount = String(total);
      outAnnualPercent = null;
      outRothPercent = total > 0 ? String(rothAmount / total) : "0";
    } else if (showRothSplit && !hasSchedule && contribMode === "percent") {
      const total = pretaxPercentInput + rothPercentInput;
      // outAnnualAmount keeps the default (a stale snapshot for new rules);
      // the engine ignores annualAmount when annualPercent is set.
      outAnnualPercent = total > 0 ? String(total / 100) : null;
      outRothPercent = total > 0 ? String(rothPercentInput / total) : "0";
    } else if (showRothSplit) {
      // max mode or any scheduled rule: rothShareOfMax sets the split directly.
      outRothPercent = String(rothShareOfMax / 100);
    }

    return {
      accountId: data.get("accountId") as string,
      annualAmount: outAnnualAmount,
      annualPercent: outAnnualPercent,
      contributeMax: contribMode === "max",
      rothPercent: outRothPercent,
      isDeductible: showRothSplit
        ? (editing?.isDeductible ?? true)
        : (showDeductibleCheckbox ? isDeductible : true),
      applyContributionLimit: showContributionCapCheckbox ? applyContributionLimit : true,
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
  }

  // Pure save: PUT when we have a rule id, POST otherwise. Schedule overrides
  // are only persisted on the first POST (mirrors existing behavior — once
  // the rule exists the user manages its schedule via the Schedule tab and
  // its own save UI). Returns SaveResult + recordId for ADD→EDIT promotion.
  async function saveCore(formEl: HTMLFormElement): Promise<SaveResult & { recordId?: string; saved?: SavingsRuleRow }> {
    const body = buildBody(formEl);
    try {
      const newRuleId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;
      const idForUpdate = effectiveRuleId;
      const res = idForUpdate
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "savings_rule",
              targetId: idForUpdate,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/savings-rules/${idForUpdate}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "savings_rule",
              entity: { id: newRuleId, ...body },
            },
            {
              url: `/api/clients/${clientId}/savings-rules`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error ?? "Failed to save savings rule" };
      }

      const saved: SavingsRuleRow = writer.scenarioActive
        ? ({
            id: idForUpdate ?? newRuleId,
            ...body,
            startYear: Number(body.startYear),
            endYear: Number(body.endYear),
          } as unknown as SavingsRuleRow)
        : ((await res.json()) as SavingsRuleRow);

      // First-create only: persist any staged schedule rows. Subsequent saves
      // skip this — the Schedule tab manages its own persistence after the
      // rule exists.
      if (!idForUpdate && stagedSchedule.length > 0 && !writer.scenarioActive) {
        await fetch(`/api/clients/${clientId}/savings-rules/${saved.id}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: stagedSchedule }),
        });
      }

      if (!idForUpdate) setEffectiveRuleId(saved.id);
      setDirty(false);
      return { ok: true, recordId: saved.id, saved };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await saveCore(e.currentTarget);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.saved) onSaved(result.saved, effectiveRuleId === editing?.id ? "edit" : "create");
    onOpenChange(false);
  }

  const autoSave = useTabAutoSave({
    isDirty: dirty,
    canSave,
    saveAsync: async () => {
      const form = formRef.current;
      if (!form) return { ok: true };
      setLoading(true);
      const result = await saveCore(form);
      setLoading(false);
      if (result.ok) autoSavedRef.current = true;
      return result;
    },
  });

  function handleFormChange() {
    if (!dirty) setDirty(true);
    const form = formRef.current;
    if (form) setCanSave(form.checkValidity());
  }

  function handleClose() {
    if (autoSavedRef.current) {
      router.refresh();
      autoSavedRef.current = false;
    }
    onOpenChange(false);
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      title={isEdit ? "Edit Savings Rule" : "Add Savings Rule"}
      size="md"
      tabs={[
        { id: "details", label: "Details" },
        { id: "schedule", label: "Schedule" },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => autoSave.interceptTabChange(id, (next) => setActiveTab(next as SavTabId))}
      tabBarRight={
        <TabAutoSaveIndicator
          saving={autoSave.saving}
          error={autoSave.saveError}
          onDismissError={autoSave.clearSaveError}
        />
      }
      primaryAction={activeTab === "details" ? {
        label: isEdit ? "Save Changes" : "Add Rule",
        form: "savings-rule-form",
        loading: loading,
        disabled: loading || autoSave.saving,
      } : undefined}
      destructiveAction={activeTab === "details" && isEdit && onRequestDelete ? {
        label: "Delete…",
        onClick: onRequestDelete,
      } : undefined}
    >
      {/* Details kept mounted across tab switches so the form's DOM state
          (uncontrolled inputs like annualAmount, employerMatchPct) survives
          a trip to Schedule and back. */}
      <div className={activeTab === "details" ? "" : "hidden"}>
        <form
          id="savings-rule-form"
          ref={formRef}
          onSubmit={handleSubmit}
          onChange={handleFormChange}
          className="space-y-4"
        >
          {error && (
            <p className="rounded border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit">
              {error}
            </p>
          )}

          <div>
            <label className={fieldLabelClassName} htmlFor="sr-account">
              Account <span className="text-red-500">*</span>
            </label>
            <select
              id="sr-account"
              name="accountId"
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={selectClassName}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {hasSchedule ? (
              // Schedule overrides bypass annual amount + growth rate. Hide
              // those inputs so the only edit path is the Schedule tab itself.
              // Hidden inputs preserve the prior values on FormData so save
              // doesn't null them — the engine ignores both fields when a
              // schedule is present, but we keep them around in case the user
              // later clears the schedule.
              <>
                <input type="hidden" name="annualAmount" value={String(editing?.annualAmount ?? "0")} />
                <input type="hidden" name="annualPercent" value={String(editing?.annualPercent ?? "")} />
                {showRothSplit && (
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400" htmlFor="sr-sched-roth-share">Roth share of contribution (%)</label>
                    <input
                      id="sr-sched-roth-share"
                      name="rothShareOfMax"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={editing?.rothPercent ? Number(editing.rothPercent) * 100 : ""}
                      className={inputClassName}
                    />
                  </div>
                )}
                <div className="col-span-2 flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-accent">Using custom schedule</p>
                    <p className="text-xs text-gray-400">Annual contribution and growth rate are overridden by the schedule. Employer match still applies.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("schedule")}
                    className="text-xs font-medium text-accent underline hover:text-accent-deep"
                  >
                    View schedule
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="col-span-2">
                  <ContributionAmountFields
                    mode={contribMode}
                    onModeChange={setContribMode}
                    showModeToggle={showContributionModeToggle}
                    showMaxToggle={showMaxToggle}
                    initialAmount={editing?.annualAmount}
                    initialPercent={editing?.annualPercent ?? null}
                    idPrefix="sr"
                    required
                    rothSplit={showRothSplit}
                    initialRothPercent={editing?.rothPercent ?? null}
                  />
                </div>
                <div className="col-span-2">
                  <label className={fieldLabelClassName}>Growth Rate</label>
                  <div className="mt-1">
                    <GrowthSourceRadio
                      value={growthSource}
                      customRate={growthRateDisplay}
                      resolvedInflationRate={resolvedInflationRate}
                      onChange={(next) => { setGrowthSource(next.value); setGrowthRateDisplay(next.customRate); }}
                    />
                  </div>
                </div>
              </>
            )}
            {showDeductibleCheckbox && !showRothSplit && (
              <div className="col-span-2">
                <DeductibleContributionCheckbox
                  checked={isDeductible}
                  onChange={setIsDeductible}
                  idPrefix="sr"
                />
              </div>
            )}
            {showContributionCapCheckbox && (
              <div className="col-span-2">
                <ContributionCapCheckbox
                  checked={applyContributionLimit}
                  onChange={setApplyContributionLimit}
                  idPrefix="sr"
                />
              </div>
            )}
            {showEmployerMatch && (
              <div className="col-span-2">
                <EmployerMatchFields
                  mode={matchMode}
                  onModeChange={setMatchMode}
                  initialPct={editing?.employerMatchPct ?? null}
                  initialCap={editing?.employerMatchCap ?? null}
                  initialAmount={editing?.employerMatchAmount ?? null}
                  idPrefix="sr"
                />
              </div>
            )}
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
                position="start"
              />
            ) : (
              <div>
                <label className={fieldLabelClassName} htmlFor="sr-start">
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
                  className={inputClassName}
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
                position="end"
              />
            ) : (
              <div>
                <label className={fieldLabelClassName} htmlFor="sr-end">
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
                  className={inputClassName}
                />
              </div>
            )}
          </div>
        </form>
      </div>

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
    </DialogShell>
  );
}
