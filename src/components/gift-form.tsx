"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Field, MoneyInput, NumberInput, Segmented, selectCls } from "@/components/gift-dialog-controls";
import { GiftWarningAlert, type GiftWarningBreach } from "@/components/gift-warning-alert";
import { checkExemptionImpact } from "@/engine/gift-exemption-warning";
import type { ClientData } from "@/engine/types";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { EstateFlowGift, GiftGrantor, GiftRecipientRef } from "@/lib/estate/estate-flow-gifts";
import { discountedGiftValue, MAX_DISCOUNT_PCT } from "@/lib/gifts/apply-valuation-discount";
import { discountAppliesToShape } from "@/lib/gifts/discount-applicability";
import { giftPercentToWhole, roundGiftPercent, wholeToGiftPercent } from "@/lib/gifts/gift-percent";
import type { AccountValueAtYear } from "@/lib/estate/account-value-at-year";
import { CO_CLIENT_LABEL, familyMemberRoleLabel } from "@/lib/owner-labels";

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
      roleLabel: familyMemberRoleLabel(m.role),
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
  /** Household accounts eligible for an in-kind transfer. `value` powers the
   *  discount preview and `subType` the appraisal soft-warning; both are
   *  optional so lighter callers (the Family view's gift dialog) still compile. */
  accounts: { id: string; name: string; value?: number; subType?: string }[];
  hasSpouse: boolean;
  annualExclusionByYear: Record<number, number>;
  editing: EstateFlowGift | null;
  /** Column-1 asset path: pre-selects in-kind funding from this account. */
  sourceAccount?: { id: string; name: string; value: number; subType?: string } | null;
  /** Projected balance of an account at a gift year — build it with
   *  `buildAccountValueAtYear`. Supplied only by surfaces that hold a live
   *  projection. Without it (or outside the projection window) the form falls
   *  back to the account's CURRENT value and says so. */
  accountValueAtYear?: AccountValueAtYear;
  /** Most-recent discount per account id, from `priorDiscountsBySource`. Seeds
   *  the discount field only — never written back to the source gift. */
  priorDiscounts?: Record<string, number>;
  /** Sandbox only — when present, render the exemption warning + enforce the plan-year window. */
  ledger?: GiftLedgerYear[];
  taxInflationRate?: number;
  /** `blockedReason` is a sentence naming the field that is holding the draft
   *  back — null whenever `draft` is non-null. Callers that refuse the save
   *  should show it instead of a generic "complete the gift" message. */
  onChange: (draft: EstateFlowGift | null, blockedReason: string | null) => void;
}

type RecipientOption = { value: string; label: string; ref: GiftRecipientRef; isTrust: boolean };
const recipientKey = (r: GiftRecipientRef) => `${r.kind}:${r.id}`;

/** Account subtypes whose holdings are readily marketable, so a lack-of-
 *  marketability discount on them is hard to support on an appraisal. Drives a
 *  soft warning only — a fractional interest in a brokerage account held inside
 *  an FLP can still qualify. */
const MARKETABLE_SUBTYPES = new Set([
  "brokerage", "savings", "checking", "money_market", "cd", "hsa",
]);

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
  // Every field below seeds from the saved gift even when it belongs to the
  // OTHER kind, so flipping Frequency on an existing gift keeps its timing and
  // its dollars. Seeded from the defaults instead, a flip can land on year 0 or
  // $0 — an invalid draft, which greys out Save with nothing on screen to
  // explain why.
  const savedYear = editing == null ? null : editing.kind === "series" ? editing.startYear : editing.year;
  const [year, setYear] = useState(() => savedYear ?? planMinYear ?? thisYear);
  const [startYear, setStartYear] = useState(() => savedYear ?? planMinYear ?? thisYear);
  const [endYear, setEndYear] = useState(() =>
    editing?.kind === "series"
      ? editing.endYear
      // Never below the start year, or the series is invalid before it is touched.
      : Math.max(planMaxYear ?? thisYear + 9, savedYear ?? 0),
  );
  const [amount, setAmount] = useState(() =>
    editing?.kind === "cash-once" ? editing.amount
    : editing?.kind === "series" ? editing.annualAmount
    : sourceAccount?.value ?? 0,
  );
  const [annualAmount, setAnnualAmount] = useState(() =>
    editing?.kind === "series" ? editing.annualAmount
    : editing?.kind === "cash-once" ? editing.amount
    : 0,
  );
  // Whether the advisor sizes the in-kind gift by share or by dollars. A saved
  // gift only ever records the share, so an edit always opens on "percent".
  const [assetSizeMode, setAssetSizeMode] = useState<"percent" | "dollars">("percent");
  // WHOLE PERCENT, to 2dp — `percent` is stored as a fraction at scale 4, so
  // 0.01% is the finest share the column can hold either way. Rounding the seed
  // to a whole number here would silently rewrite a saved 4.25% as 4%.
  const [percentInput, setPercentInput] = useState(() =>
    editing?.kind === "asset-once" ? giftPercentToWhole(editing.percent) : 100,
  );
  const [assetDollars, setAssetDollars] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState(() =>
    editing?.kind === "asset-once" ? editing.accountId : "",
  );
  const [inflationAdjust, setInflationAdjust] = useState(() => (editing?.kind === "series" ? editing.inflationAdjust : false));
  const [grantor, setGrantor] = useState<GiftGrantor>(() => editing?.grantor ?? "client");
  const [crummey, setCrummey] = useState(() => (editing && editing.kind !== "asset-once" ? editing.crummey : false));

  // ── Valuation discount ────────────────────────────────────────────────────
  // Held as WHOLE PERCENT for the input; stored on the draft as a fraction.
  // Clamped to the SAME bound the input and the save guard use: storage accepts
  // any d < 0.99995, so a row written elsewhere can carry more than the field
  // can display. Unclamped, that seeds e.g. 99.5, fails
  // `discountPct <= MAX_DISCOUNT_PCT`, and saves NULL while still showing
  // 99.5% — silently clearing a filed §709 figure.
  const [discountPct, setDiscountPct] = useState<number>(() =>
    editing?.valuationDiscount != null
      ? Math.min(MAX_DISCOUNT_PCT, Math.round(editing.valuationDiscount * 10_000) / 100)
      : 0,
  );
  // Locks out the prefill below. True from the moment the advisor types — and
  // true from the start whenever we are editing a saved gift, whose own stored
  // discount (INCLUDING "none") is authoritative. Without that second case,
  // opening an undiscounted gift on an account that carries a prior discount
  // would silently apply that discount and post a phantom "Edited gift".
  const [discountTouched, setDiscountTouched] = useState(editing != null);

  const selected = recipientOptions.find((o) => o.value === recipientValue);
  const recipientIsTrust = selected?.isTrust ?? false;
  const effectiveRecurring = isRecurring;
  const inKindAllowed = sourceAccount != null || props.accounts.length > 0;
  const effectiveInKind = !effectiveRecurring && inKindAllowed && isInKind;
  const effectiveAccountId = sourceAccount?.id ?? selectedAccountId;
  const grantorCount = grantor === "joint" ? 2 : 1;

  // Max-exclusion preview value for the relevant year.
  const exclYear = effectiveRecurring ? startYear : year;
  const exclusionAmount = (annualExclusionByYear[exclYear] ?? 0) * grantorCount;

  // Prefill from the most recent discount used for the same account. Purely an
  // initial value — see priorDiscountsBySource. Re-seeds when the advisor picks
  // a different source account, but never once the field is locked.
  const priorDiscounts = props.priorDiscounts;
  useEffect(() => {
    if (discountTouched) return;
    const prior = effectiveAccountId ? priorDiscounts?.[effectiveAccountId] : undefined;
    setDiscountPct(prior != null ? Math.round(prior * 10_000) / 100 : 0);
  }, [effectiveAccountId, discountTouched, priorDiscounts]);

  const discountApplicable = discountAppliesToShape({
    recurring: effectiveRecurring,
    inKind: effectiveInKind,
    recipientIsIrrevocableTrust: recipientIsTrust,
  });
  // `discountPct` is clamped on input, so the upper test is belt-and-braces —
  // it keeps a $0 gift unreachable if that clamp is ever loosened.
  const discountFraction =
    discountApplicable && discountPct > 0 && discountPct <= MAX_DISCOUNT_PCT
      ? discountPct / 100
      : undefined;

  const selectedAccount = sourceAccount
    ?? props.accounts.find((a) => a.id === effectiveAccountId);

  // ── What the asset is worth in the gift year ──────────────────────────────
  // The engine values an in-kind gift as `accountValueAtYear(account, year) x
  // percent`, so every dollar figure on this form — the preview, the discount
  // line, the exemption warning, and the dollars -> share conversion — reads
  // the SAME projected balance. Surfaces without a projection (and years
  // outside one) fall back to the account's current value, and say so rather
  // than passing today's number off as the gift-year number.
  //
  // All of it is gated on `effectiveInKind`: `effectiveAccountId` stays truthy
  // after the advisor toggles Funding back to Cash — and for the whole life of
  // the column-1 dialog, which always carries a sourceAccount — so without the
  // gate every keystroke on an unrelated field would re-resolve a balance
  // nothing on screen uses.
  const projectedAssetValue =
    effectiveInKind && effectiveAccountId
      ? props.accountValueAtYear?.(effectiveAccountId, year)
      : undefined;
  const assetValueIsProjected = projectedAssetValue != null;
  const assetValueAtYear = effectiveInKind
    ? projectedAssetValue ?? selectedAccount?.value ?? 0
    : 0;

  // `roundGiftPercent` holds the share to what `gifts.percent` can store — so
  // the figure previewed below is the figure that gets saved — and absorbs the
  // division by a $0 balance, which is no share rather than the whole asset.
  let assetShare = 0;
  if (effectiveInKind) {
    assetShare =
      assetSizeMode === "dollars"
        ? roundGiftPercent(assetDollars / assetValueAtYear)
        : wholeToGiftPercent(percentInput);
  }
  const assetShareWholePercent = giftPercentToWhole(assetShare);
  // Dollars the recipient actually receives — the share AFTER storage rounding,
  // not the number typed. On a large asset those differ by up to 0.01% of it.
  const assetGiftValue = assetValueAtYear * assetShare;

  // One value, not two flags: over the asset's value the share clamps to 1 and
  // never to 0, so these two can never both be true and the page should not be
  // able to render them as if they could.
  let assetDollarsWarning: "capped" | "too-small" | null = null;
  if (effectiveInKind && assetSizeMode === "dollars" && assetValueAtYear > 0) {
    if (assetDollars > assetValueAtYear) assetDollarsWarning = "capped";
    else if (assetDollars > 0 && assetShare === 0) assetDollarsWarning = "too-small";
  }

  // Today's balance standing in for a future year's is a real difference in what
  // the gift is worth, not a labelling nicety — so say it outright rather than
  // leaving the advisor to read it off the "Current value" prefix.
  const assetValueIsStaleForYear =
    effectiveInKind && !assetValueIsProjected && year > thisYear;

  // Full (pre-discount) value previewed for the relevant year.
  const previewFullValue = effectiveRecurring
    ? (amountMode === "annual_exclusion" ? exclusionAmount : annualAmount)
    : effectiveInKind
      ? assetGiftValue
      : (amountMode === "annual_exclusion" ? exclusionAmount : amount);
  const previewDiscountedValue = discountedGiftValue(previewFullValue, discountFraction);

  // A discount on cash or a marketable brokerage account has no appraisal
  // support — but a fractional interest in a brokerage account inside an FLP
  // might, so this warns rather than blocks.
  const showAppraisalWarning =
    discountFraction != null &&
    (!effectiveInKind ||
      (selectedAccount?.subType != null &&
        MARKETABLE_SUBTYPES.has(selectedAccount.subType)));

  // Returned together so every `null` draft carries the sentence that explains
  // it: a save that refuses with "please complete the gift" and no field named
  // is indistinguishable from a dead button — which is exactly how a $0 source
  // asset used to present.
  const { draft, blockedReason } = useMemo<{
    draft: EstateFlowGift | null;
    blockedReason: string | null;
  }>(() => {
    const blocked = (reason: string) => ({ draft: null, blockedReason: reason });
    const ok = (d: EstateFlowGift) => ({ draft: d, blockedReason: null });
    const yearWindow =
      planMinYear != null && planMaxYear != null ? ` between ${planMinYear} and ${planMaxYear}` : "";

    if (!selected) return blocked("Choose who receives the gift.");
    const id = editing?.id ?? newGiftId;
    const recipient = selected.ref;
    const inWindow = (y: number) =>
      planMinYear == null || planMaxYear == null ? true : y >= planMinYear && y <= planMaxYear;

    if (effectiveRecurring) {
      if (
        !Number.isFinite(startYear) || !Number.isFinite(endYear) ||
        !inWindow(startYear) || !inWindow(endYear)
      ) return blocked(`Enter a start and end year${yearWindow}.`);
      if (endYear < startYear) return blocked("The end year cannot come before the start year.");
      const annual = amountMode === "annual_exclusion" ? exclusionAmount : annualAmount;
      if (!(annual > 0)) return blocked("Enter an amount to give each year.");
      // Key order MUST match giftSeriesRowToDraft.
      const base: EstateFlowGift = {
        kind: "series", id, startYear, endYear, annualAmount: annual,
        amountMode, inflationAdjust: amountMode === "annual_exclusion" ? false : inflationAdjust,
        grantor, recipient, crummey: recipientIsTrust ? crummey : false,
        // LAST KEY — must match giftSeriesRowToDraft, or the unsaved-changes
        // diff (JSON.stringify, key-order-sensitive) reports a phantom edit.
        valuationDiscount: discountFraction,
      };
      return ok(editing?.kind === "series" ? { ...editing, ...base } : base);
    }

    if (effectiveInKind) {
      if (!effectiveAccountId) return blocked("Choose the asset to give.");
      if (!Number.isFinite(year) || !inWindow(year)) return blocked(`Enter a gift year${yearWindow}.`);
      if (!(assetShare > 0 && assetShare <= 1)) {
        // A gift is a SHARE of the asset, so an asset worth nothing can only
        // ever be a 0% gift however many dollars are typed at it. Naming the
        // account is the whole point — a household can hold two accounts one
        // word apart, only one of which has a balance.
        if (!(assetValueAtYear > 0)) {
          return blocked(
            `"${selectedAccount?.name ?? "This asset"}" is worth $0, so no share of it can be gifted.` +
              " Pick a different asset, or give the account a value first.",
          );
        }
        return blocked(
          assetSizeMode === "dollars"
            ? "Enter a dollar amount to give."
            : "Enter the percentage of the asset to give.",
        );
      }
      const base: EstateFlowGift = {
        kind: "asset-once", id, year, accountId: effectiveAccountId, percent: assetShare,
        grantor, recipient,
        amountOverride: editing?.kind === "asset-once" ? editing.amountOverride : undefined,
        eventKind: editing?.kind === "asset-once" ? editing.eventKind : undefined,
        // LAST KEY — must match giftRowToDraft's asset branch.
        valuationDiscount: discountFraction,
      };
      return ok(editing?.kind === "asset-once" ? { ...editing, ...base } : base);
    }

    // cash-once
    if (!Number.isFinite(year) || !inWindow(year)) return blocked(`Enter a gift year${yearWindow}.`);
    const amt = amountMode === "annual_exclusion" ? exclusionAmount : amount;
    if (!(amt > 0)) return blocked("Enter an amount to give.");
    const base: EstateFlowGift = {
      kind: "cash-once", id, year, amount: amt, grantor, recipient,
      crummey: recipientIsTrust ? crummey : false,
      eventKind: editing?.kind === "cash-once" ? editing.eventKind : undefined,
      // LAST KEY — must match giftRowToDraft's cash branch.
      valuationDiscount: discountFraction,
    };
    return ok(editing?.kind === "cash-once" ? { ...editing, ...base } : base);
  }, [selected, editing, newGiftId, effectiveRecurring, effectiveInKind, effectiveAccountId, year, assetShare, assetSizeMode, assetValueAtYear, selectedAccount?.name, amount, startYear, endYear, annualAmount, amountMode, exclusionAmount, inflationAdjust, grantor, crummey, discountFraction, recipientIsTrust, planMinYear, planMaxYear]);

  // Fire onChange whenever the draft *content* changes (stable JSON key so a
  // new object identity for an unchanged draft does not re-fire; onChange held
  // in a ref so a fresh parent identity does not re-fire).
  const draftJson = useMemo(
    () => (draft ? JSON.stringify(draft) : `blocked:${blockedReason}`),
    [draft, blockedReason],
  );
  const onChangeRef = useRef(props.onChange);
  useEffect(() => { onChangeRef.current = props.onChange; });
  useEffect(() => {
    onChangeRef.current(draft, blockedReason);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftJson keys both
  }, [draftJson]);

  // ── Exemption warning preview (sandbox only) ──────────────────────────────
  const breaches = useMemo<GiftWarningBreach[]>(() => {
    if (!ledger || !draft) return [];

    // taxableContribution: cash → amount, asset → gift-year account value × pct,
    // series → per-year annualAmount (preview the start year). Each is net of
    // any valuation discount — that is the figure that consumes exemption.
    //
    // `assetValueAtYear`, not `sourceAccount.value`: on the picker path (the
    // add-gift dialog) there is no sourceAccount, so this read used to be $0
    // and the warning could never fire there — beside a discount preview
    // quoting real dollars. Every dollar figure on the form now reads the one
    // gift-year value.
    let taxableContribution: number;
    let previewYear: number;
    if (draft.kind === "series") {
      taxableContribution = discountedGiftValue(draft.annualAmount, draft.valuationDiscount);
      previewYear = draft.startYear;
    } else if (draft.kind === "asset-once") {
      taxableContribution = discountedGiftValue(
        assetValueAtYear * draft.percent,
        draft.valuationDiscount,
      );
      previewYear = draft.year;
    } else {
      taxableContribution = discountedGiftValue(draft.amount, draft.valuationDiscount);
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

    const nameFor = (gname: GiftGrantor) => (gname === "client" ? "Client" : CO_CLIENT_LABEL);

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
  }, [ledger, draft, assetValueAtYear, props.taxInflationRate]);

  return (
    <div className="space-y-4 text-sm">
      {/* Frequency */}
      <Field label="Frequency">
        <Segmented
          value={effectiveRecurring ? "recurring" : "one_time"}
          options={[["one_time", "One-time"], ["recurring", "Recurring"]]}
          onChange={(v) => setIsRecurring(v === "recurring")}
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
          {props.hasSpouse && <option value="spouse">{CO_CLIENT_LABEL}</option>}
          {props.hasSpouse && <option value="joint">Both (split gift)</option>}
        </select>
        {grantor === "joint" && (
          <p className="mt-1 text-xs text-ink-3">
            Treated as half from each Co-client — uses both annual exclusions / Crummey powers.
          </p>
        )}
      </Field>

      {/* Funding (one-time only, and only when in-kind funding is allowed) */}
      {!effectiveRecurring && inKindAllowed && (
        <Field label="Funding">
          <Segmented
            value={effectiveInKind ? "asset" : "cash"}
            options={[["cash", "Cash"], ["asset", "Specific asset"]]}
            onChange={(v) => setIsInKind(v === "asset")}
          />
        </Field>
      )}

      {/* Amount controls */}
      {effectiveInKind ? (
        <div>
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
            <Field
              label="Gift size"
              hint="A gift of an asset is recorded as a share of it. Enter a dollar amount instead and it is converted to the share worth that much in the gift year."
            >
              <Segmented
                value={assetSizeMode}
                options={[["percent", "Percent"], ["dollars", "Dollar amount"]]}
                onChange={(v) => {
                  // Seed the field being switched TO from what is on screen now,
                  // so flipping the toggle never changes the size of the gift.
                  if (v === "dollars") setAssetDollars(Math.round(assetGiftValue));
                  else setPercentInput(assetShareWholePercent);
                  setAssetSizeMode(v as "percent" | "dollars");
                }}
              />
              {assetSizeMode === "percent" ? (
                <NumberInput
                  testId="asset-percent"
                  className="mt-2"
                  value={percentInput}
                  onChange={setPercentInput}
                  min={0.01}
                  max={100}
                  step={0.01}
                />
              ) : (
                <MoneyInput
                  testId="asset-dollars"
                  className="mt-2"
                  value={assetDollars}
                  onChange={setAssetDollars}
                />
              )}
            </Field>
          </div>
          {/* Not gated on a positive value: an asset worth $0 is the one case
              where the advisor most needs the number on screen, and hiding the
              line there is what made the refusal unreadable. */}
          {selectedAccount && (
            <p className="mt-2 text-xs text-ink-3" data-testid="asset-value-preview">
              {assetValueIsProjected ? `Projected value in ${year}` : "Current value"}{" "}
              <span className="tabular text-ink-2">${Math.round(assetValueAtYear).toLocaleString()}</span>
              {" · gifting "}
              <span className="tabular text-ink-2">{assetShareWholePercent}%</span>
              {" ≈ "}
              <span className="tabular font-medium text-ink-2">${Math.round(assetGiftValue).toLocaleString()}</span>
            </p>
          )}
          {assetValueIsStaleForYear && (
            <p role="status" data-testid="asset-value-not-projected" className="mt-1.5 text-xs text-warn">
              This screen has no projection, so the share is set from today&apos;s value —
              not what the asset is worth in {year}.
            </p>
          )}
          {assetDollarsWarning && (
            <p
              role="status"
              data-testid={`asset-dollars-${assetDollarsWarning}`}
              className="mt-1.5 text-xs text-warn"
            >
              {assetDollarsWarning === "capped"
                ? `That is more than the asset is worth in ${year} — capped at the whole asset.`
                : "Too small a slice of this asset to record — a share is stored to the nearest 0.01%."}
            </p>
          )}
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
              <MoneyInput key="annual" className="mt-2" value={annualAmount} onChange={setAnnualAmount} />
            ) : (
              <MoneyInput key="once" className="mt-2" value={amount} onChange={setAmount} />
            )
          ) : (
            <p className="mt-2 text-xs text-ink-3" data-testid="exclusion-hint">
              ≈ ${exclusionAmount.toLocaleString()}/yr{grantor === "joint" ? " (both Co-clients)" : ""}
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

      {/* Valuation discount */}
      {discountApplicable && (
        <div>
          <Field label="Valuation discount (%)">
            <NumberInput
              value={discountPct}
              onChange={(n) => {
                setDiscountTouched(true);
                // NumberInput hands back Number(e.target.value) unchanged, and
                // min/max are HTML hints that constrain neither typing nor
                // paste. Clamp here so the number shown is always the number
                // that will be saved: an unclamped 150 reads as 150 while
                // storing "no discount" — and on an edit that clears a
                // discount already saved.
                setDiscountPct(
                  Number.isFinite(n) ? Math.min(MAX_DISCOUNT_PCT, Math.max(0, n)) : 0,
                );
              }}
              min={0}
              max={MAX_DISCOUNT_PCT}
            />
          </Field>
          {discountFraction != null && previewFullValue > 0 && (
            <p className="mt-1.5 text-xs text-ink-3" data-testid="discount-preview">
              ${Math.round(previewFullValue).toLocaleString()} interest ·{" "}
              {discountPct}% discount ·{" "}
              <span className="font-medium text-ink-2">
                ${Math.round(previewDiscountedValue).toLocaleString()}
              </span>{" "}
              uses exemption
            </p>
          )}
          {showAppraisalWarning && (
            <p
              role="status"
              data-testid="discount-appraisal-warning"
              className="mt-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200"
            >
              Valuation discounts normally require an appraisal supporting lack of
              marketability or lack of control. Marketable securities rarely qualify.
            </p>
          )}
        </div>
      )}

      {/* Exemption warning preview */}
      {ledger && <GiftWarningAlert mode="inline" breaches={breaches} />}
    </div>
  );
}
