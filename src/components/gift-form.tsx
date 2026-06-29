"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Field, NumberInput, Segmented, selectCls } from "@/components/gift-dialog-controls";
import { GiftWarningAlert, type GiftWarningBreach } from "@/components/gift-warning-alert";
import { checkExemptionImpact } from "@/engine/gift-exemption-warning";
import type { ClientData } from "@/engine/types";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { EstateFlowGift, GiftGrantor, GiftRecipientRef } from "@/lib/estate/estate-flow-gifts";

export interface GiftFormRecipients {
  /** Irrevocable trusts only. */
  trusts: { id: string; name: string }[];
  familyMembers: { id: string; firstName: string; lastName?: string | null; roleLabel?: string }[];
  externals: { id: string; name: string; kindLabel?: string }[];
}

/** Map a `ClientData` slice to the `GiftForm` recipients shape (shared by the
 *  estate-flow add-gift + change-owner wrappers). */
export function giftFormRecipientsFromClientData(clientData: ClientData): GiftFormRecipients {
  return {
    trusts: (clientData.entities ?? [])
      .filter((e) => e.entityType === "trust" && e.isIrrevocable)
      .map((e) => ({ id: e.id, name: e.name ?? "Trust" })),
    familyMembers: (clientData.familyMembers ?? []).map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      roleLabel: m.role,
    })),
    externals: (clientData.externalBeneficiaries ?? []).map((x) => ({
      id: x.id,
      name: x.name,
      kindLabel: x.kind,
    })),
  };
}

export interface GiftFormProps {
  recipients: GiftFormRecipients;
  /** Household accounts eligible for an in-kind transfer. */
  accounts: { id: string; name: string }[];
  hasSpouse: boolean;
  annualExclusionByYear: Record<number, number>;
  editing: EstateFlowGift | null;
  /** Column-1 asset path: pre-selects in-kind funding from this account. */
  sourceAccount?: { id: string; name: string; value: number } | null;
  /** Sandbox only — when present, render the exemption warning + enforce the plan-year window. */
  ledger?: GiftLedgerYear[];
  taxInflationRate?: number;
  onChange: (draft: EstateFlowGift | null) => void;
}

type RecipientOption = { value: string; label: string; ref: GiftRecipientRef; isTrust: boolean };
const recipientKey = (r: GiftRecipientRef) => `${r.kind}:${r.id}`;

export default function GiftForm(props: GiftFormProps) {
  const { editing, sourceAccount, ledger, annualExclusionByYear } = props;

  // Plan-year window — only enforced in the sandbox (ledger present).
  const planMinYear = ledger?.[0]?.year;
  const planMaxYear = ledger ? ledger[ledger.length - 1]?.year : undefined;
  const thisYear = new Date().getFullYear();

  const recipientOptions = useMemo<RecipientOption[]>(() => {
    const opts: RecipientOption[] = [];
    for (const t of props.recipients.trusts)
      opts.push({ value: `entity:${t.id}`, label: `${t.name} (irrevocable trust)`, ref: { kind: "entity", id: t.id }, isTrust: true });
    for (const m of props.recipients.familyMembers) {
      const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
      opts.push({ value: `family_member:${m.id}`, label: m.roleLabel ? `${name} (${m.roleLabel})` : name, ref: { kind: "family_member", id: m.id }, isTrust: false });
    }
    for (const x of props.recipients.externals)
      opts.push({ value: `external_beneficiary:${x.id}`, label: x.kindLabel ? `${x.name} (${x.kindLabel})` : x.name, ref: { kind: "external_beneficiary", id: x.id }, isTrust: false });
    return opts;
  }, [props.recipients]);

  const newGiftId = useState(() => crypto.randomUUID())[0];
  const editingKind = editing?.kind ?? null;

  const [recipientValue, setRecipientValue] = useState(() => (editing ? recipientKey(editing.recipient) : ""));
  const [isRecurring, setIsRecurring] = useState(() => editingKind === "series");
  const [isInKind, setIsInKind] = useState(() => editingKind === "asset-once");
  const [amountMode, setAmountMode] = useState<"fixed" | "annual_exclusion">(() =>
    editing?.kind === "series" ? editing.amountMode : "fixed",
  );
  const [year, setYear] = useState(() => (editing && editing.kind !== "series" ? editing.year : planMinYear ?? thisYear));
  const [startYear, setStartYear] = useState(() => (editing?.kind === "series" ? editing.startYear : planMinYear ?? thisYear));
  const [endYear, setEndYear] = useState(() => (editing?.kind === "series" ? editing.endYear : planMaxYear ?? thisYear + 9));
  const [amount, setAmount] = useState(() => (editing?.kind === "cash-once" ? editing.amount : sourceAccount?.value ?? 0));
  const [annualAmount, setAnnualAmount] = useState(() => (editing?.kind === "series" ? editing.annualAmount : 0));
  const [percentWhole, setPercentWhole] = useState(() => (editing?.kind === "asset-once" ? Math.round(editing.percent * 100) : 100));
  const [selectedAccountId, setSelectedAccountId] = useState(() =>
    editing?.kind === "asset-once" ? editing.accountId : "",
  );
  const [inflationAdjust, setInflationAdjust] = useState(() => (editing?.kind === "series" ? editing.inflationAdjust : false));
  const [grantor, setGrantor] = useState<GiftGrantor>(() => editing?.grantor ?? "client");
  const [crummey, setCrummey] = useState(() => (editing && editing.kind !== "asset-once" ? editing.crummey : false));

  const selected = recipientOptions.find((o) => o.value === recipientValue);
  const recipientIsTrust = selected?.isTrust ?? false;
  const recurringAllowed = true;
  const effectiveRecurring = isRecurring;
  const inKindAllowed = sourceAccount != null || props.accounts.length > 0;
  const effectiveInKind = !effectiveRecurring && inKindAllowed && isInKind;
  const effectiveAccountId = sourceAccount?.id ?? selectedAccountId;
  const kindLocked = editing != null;
  const grantorCount = grantor === "joint" ? 2 : 1;

  // Max-exclusion preview value for the relevant year.
  const exclYear = effectiveRecurring ? startYear : year;
  const exclusionAmount = (annualExclusionByYear[exclYear] ?? 0) * grantorCount;

  const draft = useMemo<EstateFlowGift | null>(() => {
    if (!selected) return null;
    const id = editing?.id ?? newGiftId;
    const recipient = selected.ref;
    const inWindow = (y: number) =>
      planMinYear == null || planMaxYear == null ? true : y >= planMinYear && y <= planMaxYear;

    if (effectiveRecurring) {
      if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
      if (!inWindow(startYear) || !inWindow(endYear) || endYear < startYear) return null;
      const annual = amountMode === "annual_exclusion" ? exclusionAmount : annualAmount;
      if (!(annual > 0)) return null;
      // Key order MUST match giftSeriesRowToDraft.
      const base: EstateFlowGift = {
        kind: "series", id, startYear, endYear, annualAmount: annual,
        amountMode, inflationAdjust: amountMode === "annual_exclusion" ? false : inflationAdjust,
        grantor, recipient, crummey,
      };
      return editing?.kind === "series" ? { ...editing, ...base } : base;
    }

    if (effectiveInKind) {
      if (!effectiveAccountId) return null;
      if (!Number.isFinite(year) || !inWindow(year)) return null;
      if (!(percentWhole >= 1 && percentWhole <= 100)) return null;
      const base: EstateFlowGift = {
        kind: "asset-once", id, year, accountId: effectiveAccountId, percent: percentWhole / 100,
        grantor, recipient,
        amountOverride: editing?.kind === "asset-once" ? editing.amountOverride : undefined,
        eventKind: editing?.kind === "asset-once" ? editing.eventKind : undefined,
      };
      return editing?.kind === "asset-once" ? { ...editing, ...base } : base;
    }

    // cash-once
    if (!Number.isFinite(year) || !inWindow(year)) return null;
    const amt = amountMode === "annual_exclusion" ? exclusionAmount : amount;
    if (!(amt > 0)) return null;
    const base: EstateFlowGift = {
      kind: "cash-once", id, year, amount: amt, grantor, recipient,
      crummey: recipientIsTrust ? crummey : false,
      eventKind: editing?.kind === "cash-once" ? editing.eventKind : undefined,
    };
    return editing?.kind === "cash-once" ? { ...editing, ...base } : base;
  }, [selected, editing, newGiftId, effectiveRecurring, effectiveInKind, effectiveAccountId, year, percentWhole, amount, startYear, endYear, annualAmount, amountMode, exclusionAmount, inflationAdjust, grantor, crummey, recipientIsTrust, planMinYear, planMaxYear]);

  // Fire onChange whenever the draft *content* changes (stable JSON key so a
  // new object identity for an unchanged draft does not re-fire; onChange held
  // in a ref so a fresh parent identity does not re-fire).
  const draftJson = useMemo(() => (draft ? JSON.stringify(draft) : null), [draft]);
  const onChangeRef = useRef(props.onChange);
  useEffect(() => { onChangeRef.current = props.onChange; });
  useEffect(() => {
    onChangeRef.current(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftJson is draft's stable key
  }, [draftJson]);

  // ── Exemption warning preview (sandbox only) ──────────────────────────────
  const breaches = useMemo<GiftWarningBreach[]>(() => {
    if (!ledger || !draft) return [];

    // taxableContribution: cash → amount, asset → sourceAccount value × pct,
    // series → per-year annualAmount (preview the start year).
    let taxableContribution: number;
    let previewYear: number;
    if (draft.kind === "series") {
      taxableContribution = draft.annualAmount;
      previewYear = draft.startYear;
    } else if (draft.kind === "asset-once") {
      taxableContribution = (sourceAccount?.value ?? 0) * draft.percent;
      previewYear = draft.year;
    } else {
      taxableContribution = draft.amount;
      previewYear = draft.year;
    }

    // Guard against a ledger row that lacks per-grantor state (e.g. a minimal
    // fixture). A real GiftLedgerYear always carries perGrantor.client.
    const yearRow = ledger.find((r) => r.year === previewYear);
    if (!yearRow?.perGrantor) return [];

    const result = checkExemptionImpact({
      ledger,
      proposed: { grantor: draft.grantor, year: previewYear, taxableContribution },
      taxInflationRate: props.taxInflationRate ?? 0,
    });
    if (!result.exceeds) return [];

    const nameFor = (gname: GiftGrantor) => (gname === "client" ? "Client" : "Spouse");

    const out: GiftWarningBreach[] = [];
    for (const g of ["client", "spouse"] as const) {
      const b = result.perGrantor[g];
      if (b && b.overage > 0) {
        out.push({
          grantorFirstName: nameFor(g),
          overage: b.overage,
          estimatedTax: b.estimatedTax,
          firstYear: previewYear,
        });
      }
    }
    return out;
  }, [ledger, draft, sourceAccount?.value, props.taxInflationRate]);

  return (
    <div className="space-y-4 text-sm">
      {/* Frequency */}
      <Field label="Frequency">
        <Segmented
          value={effectiveRecurring ? "recurring" : "one_time"}
          options={[["one_time", "One-time"], ["recurring", "Recurring"]]}
          onChange={(v) => { if (!kindLocked) setIsRecurring(v === "recurring"); }}
          disabled={(v) => kindLocked || (v === "recurring" && !recurringAllowed)}
        />
      </Field>

      {/* Year / Start-End */}
      {effectiveRecurring ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start year">
            <NumberInput value={startYear} onChange={setStartYear} min={planMinYear} max={planMaxYear} />
          </Field>
          <Field label="End year">
            <NumberInput value={endYear} onChange={setEndYear} min={planMinYear} max={planMaxYear} />
          </Field>
        </div>
      ) : (
        <Field label="Year">
          <NumberInput value={year} onChange={setYear} min={planMinYear} max={planMaxYear} />
        </Field>
      )}

      {/* Grantor */}
      <Field label="Grantor">
        <select
          data-testid="grantor"
          value={grantor}
          onChange={(e) => setGrantor(e.target.value as GiftGrantor)}
          className={selectCls}
        >
          <option value="client">Client</option>
          {props.hasSpouse && <option value="spouse">Spouse</option>}
          {props.hasSpouse && <option value="joint">Both (split gift)</option>}
        </select>
        {grantor === "joint" && (
          <p className="mt-1 text-xs text-ink-3">
            Treated as half from each spouse — uses both annual exclusions / Crummey powers.
          </p>
        )}
      </Field>

      {/* Funding (one-time only, and only when in-kind funding is allowed) */}
      {!effectiveRecurring && inKindAllowed && (
        <Field label="Funding">
          <Segmented
            value={effectiveInKind ? "asset" : "cash"}
            options={[["cash", "Cash"], ["asset", "Specific asset"]]}
            onChange={(v) => { if (!kindLocked) setIsInKind(v === "asset"); }}
            disabled={() => kindLocked || !inKindAllowed}
          />
        </Field>
      )}

      {/* Amount controls */}
      {effectiveInKind ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Asset">
            {sourceAccount ? (
              <select data-testid="account" value={sourceAccount.id} disabled className={selectCls}>
                <option value={sourceAccount.id}>{sourceAccount.name}</option>
              </select>
            ) : (
              <select
                data-testid="account"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className={selectCls}
              >
                <option value="">— select —</option>
                {props.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Percent (%)">
            <NumberInput value={percentWhole} onChange={setPercentWhole} min={1} max={100} />
          </Field>
        </div>
      ) : (
        <Field label="Amount">
          <Segmented
            value={amountMode}
            options={[["fixed", "Fixed $"], ["annual_exclusion", "Max annual exclusion"]]}
            onChange={(v) => setAmountMode(v as "fixed" | "annual_exclusion")}
          />
          {amountMode === "fixed" ? (
            effectiveRecurring ? (
              <NumberInput className="mt-2" value={annualAmount} onChange={setAnnualAmount} />
            ) : (
              <NumberInput className="mt-2" value={amount} onChange={setAmount} />
            )
          ) : (
            <p className="mt-2 text-xs text-ink-3" data-testid="exclusion-hint">
              ≈ ${exclusionAmount.toLocaleString()}/yr{grantor === "joint" ? " (both spouses)" : ""}
            </p>
          )}
          {effectiveRecurring && amountMode === "fixed" && (
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={inflationAdjust} onChange={(e) => setInflationAdjust(e.target.checked)} />
              Inflation-adjust each year
            </label>
          )}
        </Field>
      )}

      {/* Recipient */}
      <Field label="Recipient">
        <select
          data-testid="recipient"
          value={recipientValue}
          onChange={(e) => setRecipientValue(e.target.value)}
          className={selectCls}
        >
          <option value="">— select —</option>
          {recipientOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>

      {/* Crummey (trust recipients only, not for in-kind asset gifts) */}
      {recipientIsTrust && !effectiveInKind && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={crummey} onChange={(e) => setCrummey(e.target.checked)} />
          Use Crummey powers (annual-exclusion gift)
        </label>
      )}

      {/* Exemption warning preview */}
      {ledger && <GiftWarningAlert mode="inline" breaches={breaches} />}
    </div>
  );
}
