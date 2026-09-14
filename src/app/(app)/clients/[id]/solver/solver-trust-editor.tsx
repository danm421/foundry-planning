"use client";

// The solver's per-trust editor. Renders the Estate Planning details page's own
// controls against the solver's in-memory working tree, so the two screens stay
// at parity — the components come across unchanged, only their writes are
// redirected into solver mutations (see `use-solver-trust-edits`).

import { useMemo, useState } from "react";
import type { ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { TRUST_SUB_TYPES, type TrustSubType } from "@/lib/entities/trust";
import DialogTabs from "@/components/dialog-tabs";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MoneyText from "@/components/money-text";
import AssetsTab from "@/components/forms/assets-tab";
import BeneficiaryRowList from "@/components/forms/beneficiary-row-list";
import TrustEndsSelect from "@/components/forms/trust-ends-select";
import FlowsTab, { type ScheduleSaveBinding } from "@/components/forms/flows-tab";
import SellToTrustDialog from "@/components/forms/sell-to-trust-dialog";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SwitchControl } from "@/components/forms/switch-control";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
  textareaClassName,
} from "@/components/forms/input-styles";
import { showNotesAndSalesTab } from "@/components/entity-dialog";
import { useSolverTrustEdits } from "./use-solver-trust-edits";
import {
  toAssetsTabAccounts,
  toAssetsTabBusinesses,
  toAssetsTabExpenses,
  toAssetsTabFamilyMembers,
  toAssetsTabIncomes,
  toAssetsTabLiabilities,
  toBeneficiaryExternals,
  toBeneficiaryMembers,
  toEntityOptions,
  toFlowsTabFlow,
  toTrustHousehold,
  toViewEntity,
} from "./solver-entity-adapters";

const TRUST_TYPE_LABELS: Record<TrustSubType, string> = {
  irrevocable: "Irrevocable (generic)",
  ilit: "ILIT",
  clt: "CLT (Charitable Lead Trust)",
  idgt: "IDGT (Intentionally Defective Grantor Trust)",
  crt: "CRT (Charitable Remainder Trust)",
};

type TrustTab = "details" | "assets" | "transfers" | "flows" | "notes-sales" | "notes";

interface Props {
  clientId: string;
  /** The trust to edit, as the working tree holds it. */
  entity: EntitySummary;
  /** The solver's working tree. */
  clientData: ClientData;
  /**
   * True when this trust has a real `entities` row — i.e. it came from the base
   * plan rather than being added in this solver session. A solver-added trust
   * exists only as a pending change until the scenario is saved, so nothing may
   * carry a database reference to its id yet. Gates the Notes & sales tab; see
   * the note there.
   */
  isPersisted: boolean;
  onChange: (m: SolverMutation) => void;
  /** Dissolve this trust. The caller owns the lever and the confirmation. */
  onRemove: () => void;
}

/**
 * Keyed on the trust id so selecting a different trust remounts the editor.
 * The form seeds its fields from `entity` once, at mount — without the key a
 * caller that swaps trusts in place would show the previous trust's fields and
 * write them onto the new one.
 */
export function SolverTrustEditor(props: Props) {
  return <TrustEditorBody key={props.entity.id} {...props} />;
}

function TrustEditorBody({
  clientId,
  entity,
  clientData,
  isPersisted,
  onChange,
  onRemove,
}: Props) {
  const edits = useSolverTrustEdits(entity, clientData, onChange);
  const { form, set } = edits;
  const [tab, setTab] = useState<TrustTab>("details");
  const [scheduleBinding, setScheduleBinding] = useState<ScheduleSaveBinding | null>(null);

  // One pass over the tree per recompute. Without this the editor re-maps every
  // account, liability and family member on each keystroke, and hands the
  // schedule grid a fresh array identity that re-derives all of its cell state.
  const view = useMemo(
    () => ({
      household: toTrustHousehold(clientData),
      accounts: toAssetsTabAccounts(clientData),
      liabilities: toAssetsTabLiabilities(clientData),
      incomes: toAssetsTabIncomes(clientData),
      expenses: toAssetsTabExpenses(clientData),
      businesses: toAssetsTabBusinesses(clientData),
      members: toBeneficiaryMembers(clientData),
      externals: toBeneficiaryExternals(clientData),
      entityOptions: toEntityOptions(clientData),
      familyMembers: toAssetsTabFamilyMembers(clientData),
    }),
    [clientData],
  );
  const flowOverrides = useMemo(
    () =>
      (clientData.entityFlowOverrides ?? [])
        .filter((o) => o.entityId === entity.id)
        .map((o) => ({
          year: o.year,
          incomeAmount: o.incomeAmount ?? null,
          expenseAmount: o.expenseAmount ?? null,
          distributionPercent: o.distributionPercent ?? null,
        })),
    [clientData.entityFlowOverrides, entity.id],
  );
  const planEndYear = clientData.planSettings.planEndYear;
  // Read off the ISO string, not `new Date(...)`: a bare "YYYY-01-01" parses as
  // UTC midnight, which is the previous year west of Greenwich.
  const birthYear =
    parseInt(clientData.client.dateOfBirth?.slice(0, 4) ?? "", 10) ||
    new Date().getFullYear() - 55;

  const showsNotesAndSales = showNotesAndSalesTab({
    trustSubType: form.trustSubType || null,
    isIrrevocable: edits.isIrrevocable,
    isGrantor: form.isGrantor,
  });

  const tabs = [
    { id: "details", label: "Details" },
    { id: "assets", label: "Assets" },
    { id: "transfers", label: "Transfers" },
    { id: "flows", label: "Flows" },
    ...(showsNotesAndSales ? [{ id: "notes-sales", label: "Notes & sales" }] : []),
    { id: "notes", label: "Notes" },
  ];

  const trustGifts = (clientData.gifts ?? []).filter(
    (g) => g.recipientEntityId === entity.id,
  );
  const trustNotes = (clientData.notesReceivable ?? []).filter(
    (n) => n.linkedTrustEntityId === entity.id,
  );

  return (
    <div className="flex h-full flex-col">
      <DialogTabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as TrustTab)}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {/* ── Details ───────────────────────────────────────────────────── */}
        <div className={tab !== "details" ? "hidden" : "space-y-4"}>
          <div>
            <label className={fieldLabelClassName} htmlFor="solver-trust-name">
              Name
            </label>
            <input
              id="solver-trust-name"
              type="text"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              className={inputClassName}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabelClassName} htmlFor="solver-trust-type">
                Type
              </label>
              <select
                id="solver-trust-type"
                value={form.trustSubType}
                onChange={(e) => set({ trustSubType: e.target.value as TrustSubType })}
                className={selectClassName}
              >
                <option value="" disabled>
                  — select type —
                </option>
                {TRUST_SUB_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {TRUST_TYPE_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="solver-trust-trustee">
                Trustee
              </label>
              <input
                id="solver-trust-trustee"
                type="text"
                value={form.trustee}
                onChange={(e) => set({ trustee: e.target.value })}
                placeholder="e.g., Linda, or Fidelity Trust Co."
                className={inputClassName}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fieldLabelClassName} htmlFor="solver-trust-grantor">
                Grantor
              </label>
              <select
                id="solver-trust-grantor"
                value={form.grantor}
                onChange={(e) =>
                  set({ grantor: e.target.value as "client" | "spouse" | "" })
                }
                className={selectClassName}
              >
                <option value="">Third party (none)</option>
                <option value="client">Client</option>
                <option value="spouse">Co-client</option>
              </select>
            </div>
            <div>
              <TrustEndsSelect
                household={view.household}
                value={form.trustEnds}
                onChange={(v) => set({ trustEnds: v })}
                id="solver-trust-ends"
              />
            </div>
          </div>

          <div
            className={`grid gap-4 ${
              edits.showDistributionAndIncome ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {edits.showDistributionAndIncome && (
              <BeneficiaryRowList
                tier="income"
                allowEntities={false}
                rows={form.incomeRows}
                onChange={(rows) => set({ incomeRows: rows })}
                members={view.members}
                externals={view.externals}
                entities={[]}
                household={view.household}
              />
            )}
            <BeneficiaryRowList
              tier="remainder"
              allowEntities
              rows={form.remainderRows}
              onChange={(rows) => set({ remainderRows: rows })}
              members={view.members}
              externals={view.externals}
              entities={view.entityOptions.filter((e) => e.id !== entity.id)}
              household={view.household}
            />
          </div>

          {edits.showDistributionAndIncome && (
            <div className="space-y-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Distribution Policy
                </span>
                <div className="flex gap-1 text-xs">
                  {(
                    [
                      ["none", "None"],
                      ["fixed", "Fixed $"],
                      ["pct_liquid", "% liquid"],
                      ["pct_income", "% income"],
                    ] as const
                  ).map(([val, label]) => {
                    const active =
                      val === "none"
                        ? form.distributionMode === null
                        : form.distributionMode === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() =>
                          set({ distributionMode: val === "none" ? null : val })
                        }
                        className={
                          "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors " +
                          (active
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-hair bg-card text-ink-3 hover:border-hair-2 hover:text-ink-2")
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {form.distributionMode === "fixed" && (
                <div>
                  <label className={fieldLabelClassName} htmlFor="solver-dist-amount">
                    Annual amount
                  </label>
                  <CurrencyInput
                    id="solver-dist-amount"
                    value={form.distributionAmount}
                    onChange={(v) => set({ distributionAmount: v })}
                  />
                </div>
              )}
              {(form.distributionMode === "pct_liquid" ||
                form.distributionMode === "pct_income") && (
                <div>
                  <label className={fieldLabelClassName} htmlFor="solver-dist-percent">
                    Annual percent
                  </label>
                  <PercentInput
                    id="solver-dist-percent"
                    value={form.distributionPercent}
                    onChange={(v) => set({ distributionPercent: v })}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Provisions
            </div>
            <div className="divide-y divide-hair">
              {edits.isIrrevocable && (
                <ProvisionRow
                  label="Crummey powers"
                  tooltip="Gives beneficiaries a short window (typically 30–60 days) to withdraw new contributions. Qualifies gifts to the trust for the annual gift-tax exclusion."
                  checked={form.crummeyPowers}
                  onChange={(v) => set({ crummeyPowers: v })}
                />
              )}
              {edits.isIrrevocable && (
                <ProvisionRow
                  label="Sprinkle provisions"
                  tooltip="Lets the client tap trust liquid assets once household liquid assets run out (HEMS / distribution-committee clause). Surfaces the trust in the Accessible Trust Assets column on the cash-flow drill."
                  checked={form.accessibleToClient}
                  onChange={(v) => set({ accessibleToClient: v })}
                />
              )}
              <ProvisionRow
                label="Grantor trust"
                tooltip="Trust income is taxed on the grantor's personal 1040 — the household pays the tax instead of the trust."
                checked={form.isGrantor}
                onChange={(v) =>
                  set(v ? { isGrantor: true } : { isGrantor: false, grantorStatusEndYear: "" })
                }
              />
            </div>
            {edits.isIrrevocable && form.isGrantor && (
              <div>
                <label
                  className={fieldLabelClassName}
                  htmlFor="solver-grantor-status-end-year"
                >
                  Grantor status ends after year{" "}
                  <span className="font-normal text-ink-4">(optional)</span>
                </label>
                <input
                  id="solver-grantor-status-end-year"
                  type="number"
                  min={1900}
                  max={2200}
                  step={1}
                  value={form.grantorStatusEndYear}
                  onChange={(e) =>
                    set({
                      grantorStatusEndYear:
                        e.target.value === "" ? "" : parseInt(e.target.value, 10),
                    })
                  }
                  placeholder="Leave blank for permanent"
                  className={inputClassName}
                />
              </div>
            )}
          </div>

          {(form.trustSubType === "clt" || form.trustSubType === "crt") && (
            <p className="text-[12px] text-ink-3">
              Payout terms, §7520 rate and measuring lives were set when this trust
              was funded. To change them, remove the trust and add it again.
            </p>
          )}
        </div>

        {/* ── Assets ────────────────────────────────────────────────────── */}
        <div className={tab !== "assets" ? "hidden" : "space-y-3"}>
          {edits.assetError && (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[12px] text-crit"
            >
              {edits.assetError}
            </p>
          )}
          <AssetsTab
            entityId={entity.id}
            accounts={view.accounts}
            liabilities={view.liabilities}
            incomes={view.incomes}
            expenses={view.expenses}
            familyMembers={view.familyMembers}
            entities={view.entityOptions}
            businesses={view.businesses}
            entityIsIrrevocable={edits.isIrrevocable}
            entityLabel="trust"
            onChange={edits.applyAssetOp}
          />
        </div>

        {/* ── Transfers ─────────────────────────────────────────────────── */}
        <div className={tab !== "transfers" ? "hidden" : "space-y-3"}>
          <p className="text-[12px] text-ink-3">
            Gifts to this trust, as the plan currently models them. Add or change
            one from the Gifts list.
          </p>
          {trustGifts.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink-4">
              No gifts to this trust yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {trustGifts.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
                >
                  <span className="tabular text-[12px] text-ink-3">{g.year}</span>
                  <span className="flex-1 truncate text-[13px] text-ink">
                    {g.grantor === "spouse" ? "Co-client" : "Client"} gift
                  </span>
                  <MoneyText value={g.amount} className="tabular text-[12px] text-ink-2" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Flows ─────────────────────────────────────────────────────── */}
        <div className={tab !== "flows" ? "hidden" : "space-y-3"}>
          <FlowsTab
            clientId={clientId}
            entityId={entity.id}
            entityName={form.name || entity.name || ""}
            entityType="trust"
            income={toFlowsTabFlow(clientData.incomes, entity.id)}
            expense={toFlowsTabFlow(clientData.expenses, entity.id)}
            distributionPolicyPercent={entity.distributionPolicyPercent ?? null}
            taxTreatment={entity.taxTreatment ?? "ordinary"}
            flowMode={entity.flowMode ?? "annual"}
            planStartYear={clientData.planSettings.planStartYear}
            defaultEndYear={planEndYear}
            planEndYear={planEndYear}
            primaryClientBirthYear={birthYear}
            initialFlowOverrides={flowOverrides}
            writer={edits.flowsWriter}
            // A solver-added trust has no row in the database, so the self-heal
            // POST would 404 on an id the route has never seen.
            skipEnsureCash
            saveOverrides={edits.saveFlowOverrides}
            onScheduleSaveBindingChange={setScheduleBinding}
          />
          {scheduleBinding && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void scheduleBinding.save()}
                disabled={scheduleBinding.saving}
                className="h-9 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-on disabled:opacity-50"
              >
                {scheduleBinding.saving ? "Saving…" : "Save schedule"}
              </button>
            </div>
          )}
        </div>

        {/* ── Notes & sales ─────────────────────────────────────────────── */}
        {showsNotesAndSales && (
          <div className={tab !== "notes-sales" ? "hidden" : "space-y-4"}>
            {isPersisted ? (
              <>
                <SellToTrustDialog
                  clientId={clientId}
                  scenarioId={null}
                  trust={toViewEntity(entity)}
                  accounts={view.accounts}
                  submit={edits.submitSaleToTrust}
                />
                <p className="text-[12px] text-ink-3">
                  The sale is recorded when you save the scenario — the promissory
                  note is written at that point.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-ink-3">
                This trust exists only in the solver so far, and a promissory note
                has to name a trust the plan already holds. Save this scenario
                first, then reopen the trust to sell an asset to it.
              </p>
            )}

            {trustNotes.length > 0 && (
              <ul className="space-y-1.5">
                {trustNotes.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
                  >
                    <span className="flex-1 truncate text-[13px] text-ink">{n.name}</span>
                    <span className="tabular text-[12px] text-ink-3">
                      {(n.interestRate * 100).toFixed(2)}% · {n.termMonths} mo
                    </span>
                    <MoneyText
                      value={n.faceValue}
                      className="tabular text-[12px] text-ink-2"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Notes ─────────────────────────────────────────────────────── */}
        <div className={tab !== "notes" ? "hidden" : ""}>
          <label className={fieldLabelClassName} htmlFor="solver-trust-notes">
            Notes
          </label>
          <textarea
            id="solver-trust-notes"
            rows={8}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            className={textareaClassName}
          />
        </div>
      </div>

      <div className="flex justify-end border-t border-hair px-5 py-3">
        <button
          type="button"
          onClick={onRemove}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium text-crit hover:bg-card-hover"
        >
          Remove trust
        </button>
      </div>
    </div>
  );
}

function ProvisionRow({
  label,
  tooltip,
  checked,
  onChange,
}: {
  label: string;
  tooltip: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <SwitchControl checked={checked} onChange={onChange} ariaLabel={label} />
      <span className="text-sm text-ink-2">{label}</span>
      <FieldTooltip text={tooltip} />
    </div>
  );
}
