"use client";

import { useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import GrowthSourceRadio from "./growth-source-radio";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import ScheduleTab from "@/components/schedule-tab";
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
  const writer = useScenarioWriter(clientId);
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const matchPct = data.get("employerMatchPct") as string;
    const matchCap = data.get("employerMatchCap") as string;
    const matchAmount = data.get("employerMatchAmount") as string;
    const annualAmountInput = data.get("annualAmount") as string;
    const annualPercentInput = data.get("annualPercent") as string;
    const body = {
      accountId: data.get("accountId") as string,
      annualAmount: contribMode === "amount" ? annualAmountInput : (editing?.annualAmount ?? "0"),
      annualPercent:
        contribMode === "percent" && annualPercentInput
          ? String(Number(annualPercentInput) / 100)
          : null,
      contributeMax: contribMode === "max",
      isDeductible: showDeductibleCheckbox ? isDeductible : true,
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

    try {
      // Mint the new id up-front so we can pass it to the writer's `entity`
      // payload (the unified route requires `entity.id`) and still use the
      // same id when synthesizing the optimistic row in scenario mode.
      const newRuleId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "savings_rule",
              targetId: editing!.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/savings-rules/${editing!.id}`,
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
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save savings rule");
      }

      // Base mode returns the saved row; scenario mode returns { ok, targetId }.
      // For the optimistic onSaved callback, synthesize a SavingsRuleRow from
      // the body when in scenario mode — router.refresh() (run by the writer)
      // reloads canonical state shortly after.
      const saved: SavingsRuleRow = writer.scenarioActive
        ? ({
            id: isEdit ? editing!.id : newRuleId,
            ...body,
            startYear: Number(body.startYear),
            endYear: Number(body.endYear),
          } as unknown as SavingsRuleRow)
        : ((await res.json()) as SavingsRuleRow);

      // On create: if a schedule was staged, persist it now that we have the ID.
      // Schedule overrides are nested and not in v1 scenario scope — base mode only.
      if (!isEdit && stagedSchedule.length > 0 && !writer.scenarioActive) {
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
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit Savings Rule" : "Add Savings Rule"}
      size="md"
      tabs={[
        { id: "details", label: "Details" },
        { id: "schedule", label: "Schedule" },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as SavTabId)}
      primaryAction={activeTab === "details" ? {
        label: isEdit ? "Save Changes" : "Add Rule",
        form: "savings-rule-form",
        loading: loading,
        disabled: loading,
      } : undefined}
      destructiveAction={activeTab === "details" && isEdit && onRequestDelete ? {
        label: "Delete…",
        onClick: onRequestDelete,
      } : undefined}
    >
      {activeTab === "details" && (
        <form id="savings-rule-form" onSubmit={handleSubmit} className="space-y-4">
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
              />
              {hasSchedule && (
                <p className="mt-1 text-xs text-blue-400 cursor-pointer" onClick={() => setActiveTab("schedule")}>Using custom schedule</p>
              )}
            </div>
            {showDeductibleCheckbox && (
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
      )}

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
