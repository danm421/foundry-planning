"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fieldLabelClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import { GiftWarningAlert } from "@/components/gift-warning-alert";
import type { GiftWarningBreach } from "@/components/gift-warning-alert";
import { checkExemptionImpact } from "@/engine/gift-exemption-warning";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { ClientData } from "@/engine/types";
import type {
  EstateFlowGift,
  GiftGrantor,
  GiftRecipientRef,
} from "@/lib/estate/estate-flow-gifts";

// ── Props ────────────────────────────────────────────────────────────────────

export interface EstateFlowGiftFieldsProps {
  clientData: ClientData;
  /** When launched from a column-1 asset, the source account; null for a standalone gift. */
  sourceAccount: { id: string; name: string; value: number } | null;
  /**
   * Editing an existing gift — its kind is then locked (decision 3).
   *
   * REMOUNT CONTRACT: this prop is read only by `useState` lazy initialisers,
   * so swapping it on a mounted instance would leave stale field values. The
   * parent MUST mount this component with a `key` that changes per gift —
   * e.g. `key={editing?.id ?? "new"}` — so the form remounts and re-seeds its
   * state whenever the edited gift changes.
   */
  editing: EstateFlowGift | null;
  /** Called on every valid change with the assembled draft, or null when invalid. */
  onChange: (draft: EstateFlowGift | null) => void;
  /** Gift exemption ledger from the live projection — for the inline warning preview. */
  ledger: GiftLedgerYear[];
  /** Plan tax-inflation rate, used to project BEA growth for the warning preview. */
  taxInflationRate: number;
}

// ── Local UI model ───────────────────────────────────────────────────────────

/** One of the three EstateFlowGift kinds, surfaced as two UI axes:
 *  one-time vs recurring, and (for one-time) cash vs in-kind asset. */
type DraftKind = "cash-once" | "asset-once" | "series";

interface RecipientOption {
  value: string; // "<kind>:<id>"
  label: string;
  ref: GiftRecipientRef;
  /** True only for irrevocable trusts — gates recurring + in-kind. */
  isIrrevocableTrust: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const recipientKey = (r: GiftRecipientRef) => `${r.kind}:${r.id}`;

/** Segmented-toggle button styling, mirroring the estate-flow dark theme. */
function segButtonClassName(active: boolean, disabled: boolean): string {
  const base =
    "flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium transition-colors";
  // A disabled-but-active button (a locked kind while editing) keeps an accent
  // tint so the advisor can still see which kind the locked gift is.
  if (disabled && active)
    return `${base} cursor-not-allowed bg-accent/10 text-accent/70 ring-1 ring-accent/25`;
  if (disabled) return `${base} cursor-not-allowed text-ink-4`;
  if (active)
    return `${base} bg-accent/15 text-accent ring-1 ring-accent/40`;
  return `${base} text-ink-3 hover:text-ink-2`;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Gift add/edit form. State is seeded once from `editing`/`sourceAccount` via
 * `useState` lazy initialisers and is NOT synced back from props afterwards.
 *
 * REMOUNT CONTRACT: the parent MUST give this component a `key` that changes
 * per gift — e.g. `key={editing?.id ?? "new"}` — so the form remounts (and
 * re-seeds its state) whenever the edited gift changes. Tasks 8 and 9 rely on
 * this; do not add prop→state sync effects instead.
 */
export function EstateFlowGiftFields({
  clientData,
  sourceAccount,
  editing,
  onChange,
  ledger,
  taxInflationRate,
}: EstateFlowGiftFieldsProps) {
  // Plan-year window, derived from the ledger.
  const planMinYear = ledger[0]?.year ?? new Date().getFullYear();
  const planMaxYear = ledger[ledger.length - 1]?.year ?? planMinYear;

  // ── Recipient options ──────────────────────────────────────────────────────
  const recipientOptions = useMemo<RecipientOption[]>(() => {
    const opts: RecipientOption[] = [];

    // Children — family members whose household role is "child".
    for (const fm of clientData.familyMembers ?? []) {
      if (fm.role !== "child") continue;
      const name = [fm.firstName, fm.lastName].filter(Boolean).join(" ");
      opts.push({
        value: `family_member:${fm.id}`,
        label: `${name || "Child"} (child)`,
        ref: { kind: "family_member", id: fm.id },
        isIrrevocableTrust: false,
      });
    }

    // Irrevocable trusts.
    for (const e of clientData.entities ?? []) {
      if (e.entityType !== "trust" || !e.isIrrevocable) continue;
      opts.push({
        value: `entity:${e.id}`,
        label: `${e.name ?? "Trust"} (irrevocable trust)`,
        ref: { kind: "entity", id: e.id },
        isIrrevocableTrust: true,
      });
    }

    // External beneficiaries.
    for (const eb of clientData.externalBeneficiaries ?? []) {
      opts.push({
        value: `external_beneficiary:${eb.id}`,
        label: `${eb.name} (external beneficiary)`,
        ref: { kind: "external_beneficiary", id: eb.id },
        isIrrevocableTrust: false,
      });
    }

    return opts;
  }, [
    clientData.familyMembers,
    clientData.entities,
    clientData.externalBeneficiaries,
  ]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [recipientValue, setRecipientValue] = useState<string>(() =>
    editing ? recipientKey(editing.recipient) : "",
  );

  // Stable id for a NEW gift — generated once, kept across renders so the
  // draft identity does not churn. When editing, `editing.id` is used instead.
  const newGiftId = useState(() => crypto.randomUUID())[0];

  const editingKind: DraftKind | null = editing ? editing.kind : null;

  const [isRecurring, setIsRecurring] = useState<boolean>(
    () => editingKind === "series",
  );
  const [isInKind, setIsInKind] = useState<boolean>(
    () => editingKind === "asset-once",
  );

  // One-time fields.
  const [year, setYear] = useState<number>(() => {
    if (editing && editing.kind !== "series") return editing.year;
    return planMinYear;
  });
  // percent stored as a whole number 1–100 in the UI; converted to a 0–1
  // fraction when assembling the asset-once draft (matches giftRowToDraft).
  const [percentWhole, setPercentWhole] = useState<number>(() => {
    if (editing?.kind === "asset-once")
      return Math.round(editing.percent * 100);
    return 100;
  });
  const [amount, setAmount] = useState<number>(() => {
    if (editing?.kind === "cash-once") return editing.amount;
    return sourceAccount?.value ?? 0;
  });

  // Recurring fields.
  const [startYear, setStartYear] = useState<number>(() =>
    editing?.kind === "series" ? editing.startYear : planMinYear,
  );
  const [endYear, setEndYear] = useState<number>(() =>
    editing?.kind === "series" ? editing.endYear : planMaxYear,
  );
  const [annualAmount, setAnnualAmount] = useState<number>(() =>
    editing?.kind === "series" ? editing.annualAmount : 0,
  );
  const [inflationAdjust, setInflationAdjust] = useState<boolean>(() =>
    editing?.kind === "series" ? editing.inflationAdjust : false,
  );

  // Shared fields.
  const [grantor, setGrantor] = useState<GiftGrantor>(
    () => editing?.grantor ?? "client",
  );
  // Reads editing.crummey only for non-asset-once kinds — asset-once gifts have
  // no crummey field, so they seed to false.
  const [crummey, setCrummey] = useState<boolean>(() =>
    editing && editing.kind !== "asset-once" ? editing.crummey : false,
  );

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedRecipient = recipientOptions.find(
    (o) => o.value === recipientValue,
  );
  const recipientIsTrust = selectedRecipient?.isIrrevocableTrust ?? false;

  // Decision 2: recurring only to irrevocable trusts. Force one-time otherwise.
  const recurringAllowed = recipientIsTrust;
  const effectiveRecurring = recurringAllowed && isRecurring;

  // Decision 1: in-kind only to irrevocable trusts and only with a source
  // account. Cash everywhere else.
  const inKindAllowed = recipientIsTrust && sourceAccount != null;
  const effectiveInKind = !effectiveRecurring && inKindAllowed && isInKind;

  // Decision 3: when editing, the kind axis is locked.
  const kindLocked = editing != null;

  // ── Draft assembly ─────────────────────────────────────────────────────────
  // Key order MUST match giftRowToDraft / giftSeriesRowToDraft so the
  // JSON.stringify diff in estate-flow-gift-diff.ts does not see spurious
  // edits. When editing, we spread `editing` first so any keys we do not
  // touch keep their original position.
  const draft = useMemo<EstateFlowGift | null>(() => {
    if (!selectedRecipient) return null;
    const id = editing?.id ?? newGiftId;
    const recipient = selectedRecipient.ref;

    if (effectiveRecurring) {
      if (grantor === "joint") return null; // series grantor is client|spouse
      if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;
      if (startYear < planMinYear || endYear > planMaxYear) return null;
      if (endYear < startYear) return null;
      if (!(annualAmount > 0)) return null;
      // Key order: kind, id, startYear, endYear, annualAmount,
      // inflationAdjust, grantor, recipient, crummey.
      const base: EstateFlowGift = {
        kind: "series",
        id,
        startYear,
        endYear,
        annualAmount,
        inflationAdjust,
        grantor,
        recipient,
        crummey,
      };
      return editing?.kind === "series" ? { ...editing, ...base } : base;
    }

    if (effectiveInKind && sourceAccount) {
      if (!Number.isFinite(year)) return null;
      if (year < planMinYear || year > planMaxYear) return null;
      if (!(percentWhole >= 1 && percentWhole <= 100)) return null;
      // Key order: kind, id, year, accountId, percent, grantor, recipient,
      // amountOverride, eventKind.
      const base: EstateFlowGift = {
        kind: "asset-once",
        id,
        year,
        accountId: sourceAccount.id,
        percent: percentWhole / 100,
        grantor,
        recipient,
        amountOverride:
          editing?.kind === "asset-once" ? editing.amountOverride : undefined,
        eventKind: editing?.kind === "asset-once" ? editing.eventKind : undefined,
      };
      return editing?.kind === "asset-once" ? { ...editing, ...base } : base;
    }

    // cash-once
    if (!Number.isFinite(year)) return null;
    if (year < planMinYear || year > planMaxYear) return null;
    if (!(amount > 0)) return null;
    // Key order: kind, id, year, amount, grantor, recipient, crummey, eventKind.
    const base: EstateFlowGift = {
      kind: "cash-once",
      id,
      year,
      amount,
      grantor,
      recipient,
      crummey: recipientIsTrust ? crummey : false,
      eventKind: editing?.kind === "cash-once" ? editing.eventKind : undefined,
    };
    return editing?.kind === "cash-once" ? { ...editing, ...base } : base;
  }, [
    selectedRecipient,
    editing,
    newGiftId,
    effectiveRecurring,
    effectiveInKind,
    sourceAccount,
    year,
    percentWhole,
    amount,
    startYear,
    endYear,
    annualAmount,
    inflationAdjust,
    grantor,
    crummey,
    recipientIsTrust,
    planMinYear,
    planMaxYear,
  ]);

  // Fire onChange from an effect whenever the draft *content* changes.
  // `draftJson` is a stable serialisation used as the effect key, so a new
  // object identity for an unchanged draft does not re-fire. The latest
  // `onChange` is held in a ref so a fresh `onChange` identity from the parent
  // does not re-fire the effect either. The effect runs after the first
  // commit, which satisfies "fire on mount" with the initial draft (or null).
  const draftJson = useMemo(
    () => (draft ? JSON.stringify(draft) : null),
    [draft],
  );
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft intentionally omitted; draftJson is its stable key
  }, [draftJson]);

  // ── Exemption warning preview ──────────────────────────────────────────────
  const breaches = useMemo<GiftWarningBreach[]>(() => {
    if (!draft) return [];

    // taxableContribution: per decision/plan, cash → amount, asset → value×pct,
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

    const result = checkExemptionImpact({
      ledger,
      proposed: { grantor: draft.grantor, year: previewYear, taxableContribution },
      taxInflationRate,
    });
    if (!result.exceeds) return [];

    const nameFor = (g: "client" | "spouse") => {
      const fm = (clientData.familyMembers ?? []).find((m) => m.role === g);
      return fm?.firstName ?? (g === "client" ? "Client" : "Spouse");
    };

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
    // Narrowed: only sourceAccount?.value and clientData.familyMembers are read.
  }, [
    draft,
    ledger,
    taxInflationRate,
    sourceAccount?.value,
    clientData.familyMembers,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Recipient picker */}
      <div>
        <label className={fieldLabelClassName} htmlFor="gift-recipient">
          Recipient
        </label>
        <select
          id="gift-recipient"
          className={selectClassName}
          value={recipientValue}
          onChange={(e) => setRecipientValue(e.target.value)}
        >
          <option value="">Select a recipient…</option>
          {recipientOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* One-time / recurring toggle */}
      <div>
        <p className={fieldLabelClassName}>Frequency</p>
        <div className="flex gap-1.5 rounded-[var(--radius-sm)] bg-card-2 p-1">
          <button
            type="button"
            disabled={kindLocked}
            className={segButtonClassName(!effectiveRecurring, kindLocked)}
            onClick={() => !kindLocked && setIsRecurring(false)}
          >
            One-time
          </button>
          <button
            type="button"
            disabled={kindLocked || !recurringAllowed}
            className={segButtonClassName(
              effectiveRecurring,
              kindLocked || !recurringAllowed,
            )}
            onClick={() =>
              !kindLocked && recurringAllowed && setIsRecurring(true)
            }
          >
            Recurring
          </button>
        </div>
        {!recurringAllowed && !kindLocked && (
          <p className="mt-1 text-[11px] text-ink-4">
            Recurring gifts are only available to irrevocable trusts.
          </p>
        )}
      </div>

      {/* In-kind / cash sub-toggle (one-time only) */}
      {!effectiveRecurring && (
        <div>
          <p className={fieldLabelClassName}>Transfer type</p>
          <div className="flex gap-1.5 rounded-[var(--radius-sm)] bg-card-2 p-1">
            <button
              type="button"
              disabled={kindLocked || !inKindAllowed}
              className={segButtonClassName(!effectiveInKind, kindLocked)}
              onClick={() => !kindLocked && setIsInKind(false)}
            >
              Cash
            </button>
            <button
              type="button"
              disabled={kindLocked || !inKindAllowed}
              className={segButtonClassName(
                effectiveInKind,
                kindLocked || !inKindAllowed,
              )}
              onClick={() =>
                !kindLocked && inKindAllowed && setIsInKind(true)
              }
            >
              In-kind asset
            </button>
          </div>
          {!inKindAllowed && (
            <p className="mt-1 text-[11px] text-ink-4">
              {sourceAccount == null
                ? "Standalone gifts are always cash."
                : "In-kind asset transfers are only available to irrevocable trusts."}
            </p>
          )}
        </div>
      )}

      {/* One-time fields */}
      {!effectiveRecurring && (
        <div className="flex flex-col gap-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="gift-year">
              Year
            </label>
            <input
              id="gift-year"
              type="number"
              className={inputClassName}
              min={planMinYear}
              max={planMaxYear}
              value={Number.isFinite(year) ? year : ""}
              // Out-of-window years are caught by draft validation, consistent
              // with gift-start-year / gift-end-year — no onChange clamp.
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>

          {effectiveInKind ? (
            <div>
              <label className={fieldLabelClassName} htmlFor="gift-percent">
                Percent of {sourceAccount?.name ?? "asset"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="gift-percent"
                  type="number"
                  className={inputClassName}
                  min={1}
                  max={100}
                  value={Number.isFinite(percentWhole) ? percentWhole : ""}
                  onChange={(e) => setPercentWhole(Number(e.target.value))}
                />
                <span className="text-[13px] text-ink-3">%</span>
              </div>
              {sourceAccount && (
                <p className="mt-1 text-[11px] text-ink-4">
                  ≈{" "}
                  {fmt.format(
                    sourceAccount.value *
                      (Number.isFinite(percentWhole) ? percentWhole : 0) /
                      100,
                  )}{" "}
                  of {fmt.format(sourceAccount.value)}
                </p>
              )}
            </div>
          ) : (
            <div>
              <label className={fieldLabelClassName} htmlFor="gift-amount">
                Amount
              </label>
              <input
                id="gift-amount"
                type="number"
                className={inputClassName}
                min={0}
                value={Number.isFinite(amount) ? amount : ""}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
              {sourceAccount && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-4">
                  <span>% of {sourceAccount.name}:</span>
                  {[25, 50, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className="rounded border border-hair px-1.5 py-0.5 text-ink-3 hover:border-accent/40 hover:text-accent"
                      onClick={() =>
                        setAmount(
                          Math.round((sourceAccount.value * pct) / 100),
                        )
                      }
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recurring fields */}
      {effectiveRecurring && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={fieldLabelClassName} htmlFor="gift-start-year">
                Start year
              </label>
              <input
                id="gift-start-year"
                type="number"
                className={inputClassName}
                min={planMinYear}
                max={planMaxYear}
                value={Number.isFinite(startYear) ? startYear : ""}
                onChange={(e) => setStartYear(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className={fieldLabelClassName} htmlFor="gift-end-year">
                End year
              </label>
              <input
                id="gift-end-year"
                type="number"
                className={inputClassName}
                min={planMinYear}
                max={planMaxYear}
                value={Number.isFinite(endYear) ? endYear : ""}
                onChange={(e) => setEndYear(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <label
              className={fieldLabelClassName}
              htmlFor="gift-annual-amount"
            >
              Annual amount
            </label>
            <input
              id="gift-annual-amount"
              type="number"
              className={inputClassName}
              min={0}
              value={Number.isFinite(annualAmount) ? annualAmount : ""}
              onChange={(e) => setAnnualAmount(Number(e.target.value))}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)] h-4 w-4 shrink-0"
              checked={inflationAdjust}
              onChange={(e) => setInflationAdjust(e.target.checked)}
            />
            Increase annual amount with inflation
          </label>
        </div>
      )}

      {/* Grantor */}
      <div>
        <label className={fieldLabelClassName} htmlFor="gift-grantor">
          Grantor
        </label>
        <select
          id="gift-grantor"
          className={selectClassName}
          value={grantor}
          onChange={(e) => setGrantor(e.target.value as GiftGrantor)}
        >
          <option value="client">Client</option>
          <option value="spouse">Spouse</option>
          {/* Joint is invalid for recurring gifts (series grantor is client|spouse). */}
          {!effectiveRecurring && <option value="joint">Joint</option>}
        </select>
      </div>

      {/* Crummey powers — trusts only, and not for in-kind asset gifts. */}
      {recipientIsTrust && !effectiveInKind && (
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-2">
          <input
            type="checkbox"
            className="accent-[var(--color-accent)] h-4 w-4 shrink-0"
            checked={crummey}
            onChange={(e) => setCrummey(e.target.checked)}
          />
          Apply Crummey withdrawal powers
        </label>
      )}

      {/* Exemption warning preview */}
      <GiftWarningAlert mode="inline" breaches={breaches} />
    </div>
  );
}
