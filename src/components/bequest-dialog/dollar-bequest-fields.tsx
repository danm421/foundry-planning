"use client";

import { useState } from "react";
import {
  checkboxClassName,
  fieldLabelClassName,
  inputClassName,
  selectClassName,
} from "@/components/forms/input-styles";
import DollarRecipientList from "@/components/forms/dollar-recipient-list";
import type { DollarBequestDraft } from "@/components/bequest-dialog";
import type {
  WillGrantor,
  WillsPanelAccount,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
} from "@/components/wills-panel";

export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

const ESTATE_VALUE = "estate";
const ACCOUNT_PREFIX = "account:";
const REMOVED_VALUE = "__removed__";

/** Dollars and optional cents; anything else (blank, "abc", "-5", "1e3") is NaN. */
function parseAmount(text: string): number {
  const t = text.trim().replace(/,/g, "");
  return /^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(t) ? Number(t) : NaN;
}

const amountText = (n: number) => (Number.isFinite(n) ? String(n) : "");

interface DollarBequestFieldsProps {
  draft: DollarBequestDraft;
  onChange: (draft: DollarBequestDraft) => void;
  grantor: WillGrantor;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
}

/** The Dollar amount tab: source, recipients with amounts, total. The Condition
 *  buttons belong to the dialog and sit under this. */
export default function DollarBequestFields({
  draft,
  onChange,
  grantor,
  primary,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
}: DollarBequestFieldsProps) {
  // Text the advisor is typing lives here; the draft only ever holds the parsed
  // number (NaN while it isn't one), which keeps Save off.
  const [sameAmount, setSameAmount] = useState(() => {
    const rs = draft.recipients;
    const first = rs[0]?.amount;
    return rs.length === 0 || !Number.isFinite(first) || rs.every((r) => r.amount === first);
  });
  const [eachText, setEachText] = useState(() => {
    const first = draft.recipients[0]?.amount;
    return draft.recipients.every((r) => r.amount === first) ? amountText(first) : "";
  });
  const [rowTexts, setRowTexts] = useState(() => draft.recipients.map((r) => amountText(r.amount)));

  const setRecipients = (recipients: DollarBequestDraft["recipients"]) =>
    onChange({ ...draft, recipients });

  const total = draft.recipients.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);

  const sourceRemoved = draft.dollarSource === "account" && draft.accountId == null;
  const sourceValue = sourceRemoved
    ? REMOVED_VALUE
    : draft.dollarSource === "estate"
      ? ESTATE_VALUE
      : `${ACCOUNT_PREFIX}${draft.accountId}`;
  // `canPayDollarGift` is the will routes' own source rule. The account already
  // on the gift stays pickable even if it no longer passes: a re-save keeps it.
  const pickable = accounts.filter((a) => a.canPayDollarGift || a.id === draft.accountId);

  function changeSource(value: string) {
    if (value === ESTATE_VALUE) {
      onChange({ ...draft, dollarSource: "estate", accountId: null, fallbackToEstate: false });
    } else if (value.startsWith(ACCOUNT_PREFIX)) {
      onChange({ ...draft, dollarSource: "account", accountId: value.slice(ACCOUNT_PREFIX.length) });
    }
  }

  function changeEach(text: string) {
    setEachText(text);
    const amount = parseAmount(text);
    setRecipients(draft.recipients.map((r) => ({ ...r, amount })));
  }

  function changeRow(idx: number, text: string) {
    setRowTexts(rowTexts.map((t, i) => (i === idx ? text : t)));
    setRecipients(
      draft.recipients.map((r, i) => (i === idx ? { ...r, amount: parseAmount(text) } : r)),
    );
  }

  function toggleSame(on: boolean) {
    setSameAmount(on);
    if (on) {
      const text = rowTexts[0] ?? eachText;
      setEachText(text);
      const amount = parseAmount(text);
      setRecipients(draft.recipients.map((r) => ({ ...r, amount })));
    } else {
      setRowTexts(draft.recipients.map(() => eachText));
    }
  }

  function add() {
    setRowTexts([...rowTexts, sameAmount ? eachText : ""]);
    setRecipients([
      ...draft.recipients,
      {
        recipientKind: "family_member",
        recipientId: null,
        amount: sameAmount ? parseAmount(eachText) : NaN,
        sortOrder: draft.recipients.length,
      },
    ]);
  }

  function remove(idx: number) {
    setRowTexts(rowTexts.filter((_, i) => i !== idx));
    setRecipients(
      draft.recipients.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="dollar-paid-from" className={fieldLabelClassName}>Paid from</label>
        <select
          id="dollar-paid-from"
          value={sourceValue}
          onChange={(e) => changeSource(e.target.value)}
          className={selectClassName}
        >
          <option value={ESTATE_VALUE}>Estate — cash &amp; brokerage</option>
          {sourceRemoved && (
            <option value={REMOVED_VALUE} disabled>
              (account removed)
            </option>
          )}
          {pickable.map((a) => (
            <option key={a.id} value={`${ACCOUNT_PREFIX}${a.id}`}>
              {a.name}
              {a.value != null ? ` — ${formatCurrency(a.value)}` : ""}
            </option>
          ))}
        </select>
        {draft.dollarSource === "account" && draft.accountId != null && (
          <label className="mt-2 flex items-start gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={draft.fallbackToEstate}
              onChange={(e) => onChange({ ...draft, fallbackToEstate: e.target.checked })}
              className={checkboxClassName + " mt-0.5"}
            />
            If this account runs out or is deleted, pay the rest from any cash or brokerage
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          checked={sameAmount}
          onChange={(e) => toggleSame(e.target.checked)}
          className={checkboxClassName}
        />
        Same amount to each
      </label>

      {sameAmount && (
        <div className="max-w-[12rem]">
          <label htmlFor="dollar-amount-each" className={fieldLabelClassName}>Amount each</label>
          <input
            id="dollar-amount-each"
            type="text"
            inputMode="decimal"
            value={eachText}
            onChange={(e) => changeEach(e.target.value)}
            className={inputClassName + " tabular"}
          />
        </div>
      )}

      <DollarRecipientList
        grantor={grantor}
        rows={draft.recipients}
        amountTexts={rowTexts}
        sameAmount={sameAmount}
        onPickRecipient={(idx, fields) =>
          setRecipients(draft.recipients.map((r, i) => (i === idx ? { ...r, ...fields } : r)))
        }
        onAmountText={changeRow}
        onAdd={add}
        onRemove={remove}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externalBeneficiaries}
        entities={entities}
      />

      <p className="tabular text-sm text-ink-2">Total {formatCurrency(total)}</p>
    </div>
  );
}
