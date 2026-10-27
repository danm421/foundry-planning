"use client";

// Wizard step 4: what goes into the trust, and when. The advisor adds any
// number of items (a gift now, a bequest at death, a policy transfer, or an
// account moved in) or skips. It takes a `trust` description rather than the
// wizard's answers so the "Add funding" pane for an existing trust can reuse it.

import { useMemo, useState } from "react";
import GiftForm, { giftFormRecipientsFromClientData } from "@/components/gift-form";
import type { Account } from "@/engine/types";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { FundingItem, GuidedTrustContext, GuidedTrustKind } from "@/lib/solver/guided-trust";
import { fundingItemLabel, giftExemptionPreview } from "@/lib/solver/guided-trust-batch";
import { roleFirstName } from "@/lib/solver/trust-labels";
import { usd } from "@/lib/solver/technique-summaries";
import { isRetitleFundingEligible } from "@/lib/solver/trust-levers";
import { GuidedTrustBequestFields } from "./guided-trust-bequest-fields";
import { Callout, StepHeader } from "./guided-trust-ui";

export interface FundingTrust {
  id: string;
  name: string;
  grantor: "client" | "spouse";
  crummeyPowers: boolean;
  kind: GuidedTrustKind;
  /** How many people hold Crummey powers (sizes the annual-exclusion cover). */
  crummeyHolders: number;
}

interface Props {
  trust: FundingTrust;
  items: FundingItem[];
  onItemsChange: (next: FundingItem[]) => void;
  ctx: GuidedTrustContext;
}

type Tile = "gift" | "bequest" | "policy" | "retitle" | "sale";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const addBtn = `rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-on disabled:opacity-40 ${focusRing}`;

const TILES: Record<Tile, { name: string; note: string }> = {
  gift: { name: "During life", note: "A gift now or later. Removes it, and its growth, from the estate." },
  bequest: {
    name: "At death",
    note: "A bequest in the will. Doesn't lower that death's estate tax; it controls who gets it and how.",
  },
  policy: { name: "Transfer a policy", note: "Move an existing life insurance policy into the trust." },
  retitle: { name: "Move an account in", note: "Retitle an existing account into the trust." },
  sale: {
    name: "Sale for a note",
    note: "Available once the scenario is saved — then use this trust's Notes & sales tab.",
  },
};

function tilesFor(kind: GuidedTrustKind): Tile[] {
  if (kind === "ilit") return ["policy", "gift", "bequest"];
  if (kind === "idgt") return ["gift", "bequest", "sale"];
  return ["gift", "bequest", "retitle"];
}

const CHIP: Record<FundingItem["kind"], string> = {
  gift: "Gift",
  bequest: "Bequest",
  policy: "Transfer",
  retitle: "Transfer",
};

/** Household-owned: every owner slice is a family member. */
const householdOwned = (a: Account) => a.owners.every((o) => o.kind === "family_member");

export function GuidedTrustFundingStep({ trust, items, onItemsChange, ctx }: Props) {
  const tiles = tilesFor(trust.kind);
  const [tile, setTile] = useState<Tile>(tiles[0]);
  const { tree } = ctx;

  const add = (...more: FundingItem[]) => onItemsChange([...items, ...more]);

  const movedIds = new Set(
    items.flatMap((i) => (i.kind === "retitle" ? [i.accountId] : [])),
  );
  const giftedIds = new Set(
    items.flatMap((i) => (i.kind === "gift" && i.gift.kind === "asset-once" ? [i.gift.accountId] : [])),
  );
  const bequests = items.filter((i): i is Extract<FundingItem, { kind: "bequest" }> => i.kind === "bequest");

  return (
    <div>
      <StepHeader title="What goes in, and when?" subtitle="Add one or more. You can skip and fund it later." />

      {items.length > 0 ? (
        <ul aria-label="Funding added" className="mb-3 space-y-1">
          {items.map((item, i) => {
            const label = fundingItemLabel(item, tree);
            return (
              <li
                key={i}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1 text-[12.5px] text-ink-2"
              >
                <span className="rounded-[3px] bg-accent-wash px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                  {CHIP[item.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => onItemsChange(items.filter((_, j) => j !== i))}
                  className={`rounded px-1.5 text-ink-3 hover:text-ink ${focusRing}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div role="radiogroup" aria-label="Kind of funding" className="grid grid-cols-3 gap-2">
        {tiles.map((t) => {
          const { name, note } = TILES[t];
          const disabled = t === "sale";
          const on = tile === t && !disabled;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={disabled || undefined}
              aria-labelledby={`fund-tile-${t}-name`}
              aria-describedby={`fund-tile-${t}-note`}
              onClick={() => {
                if (!disabled) setTile(t);
              }}
              className={`rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors ${focusRing} ${
                disabled
                  ? "cursor-not-allowed border-dashed border-hair opacity-70"
                  : on
                    ? "border-accent bg-accent-wash"
                    : "border-hair hover:border-hair-2"
              }`}
            >
              <span id={`fund-tile-${t}-name`} className="block text-[13px] font-medium text-ink">
                {name}
              </span>
              <span id={`fund-tile-${t}-note`} className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                {note}
              </span>
            </button>
          );
        })}
      </div>

      {/* Fallback only: the step targets no scrolling, but a tall gift form
          plus a long item list may overflow the dialog. */}
      <div className="mt-3 max-h-[34vh] overflow-y-auto pr-1">
        {tile === "gift" ? (
          <GiftPanel trust={trust} ctx={ctx} excludedAccountIds={movedIds} onAdd={(g) => add({ kind: "gift", gift: g })} />
        ) : tile === "bequest" ? (
          <GuidedTrustBequestFields
            trust={{ id: trust.id, name: trust.name }}
            ctx={ctx}
            existing={bequests}
            onAdd={(b) => add(b)}
          />
        ) : tile === "policy" ? (
          <PolicyPanel
            accounts={tree.accounts.filter(
              (a) =>
                a.category === "life_insurance" &&
                householdOwned(a) &&
                !items.some((i) => i.kind === "policy" && i.accountId === a.id),
            )}
            onAdd={(accountId) => add({ kind: "policy", accountId })}
          />
        ) : tile === "retitle" ? (
          <RetitlePanel
            accounts={tree.accounts.filter(
              (a) => isRetitleFundingEligible(a) && !movedIds.has(a.id) && !giftedIds.has(a.id),
            )}
            onAdd={(ids) => add(...ids.map((accountId) => ({ kind: "retitle" as const, accountId })))}
          />
        ) : null}
      </div>
    </div>
  );
}

function GiftPanel({
  trust,
  ctx,
  excludedAccountIds,
  onAdd,
}: {
  trust: FundingTrust;
  ctx: GuidedTrustContext;
  excludedAccountIds: Set<string>;
  onAdd: (g: EstateFlowGift) => void;
}) {
  const { tree } = ctx;
  const [draft, setDraft] = useState<EstateFlowGift | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  // Remounting the form with a fresh key is how it resets after an Add.
  const [formKey, setFormKey] = useState(0);

  const recipients = useMemo(() => giftFormRecipientsFromClientData(tree), [tree]);
  const accounts = tree.accounts
    .filter((a) => isRetitleFundingEligible(a) && !excludedAccountIds.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, value: a.value, subType: a.subType }));

  const preview = draft
    ? giftExemptionPreview(draft, {
        annualExclusionByYear: ctx.annualExclusionByYear,
        crummeyHolders: trust.crummeyHolders,
        accountValue: (id) => tree.accounts.find((a) => a.id === id)?.value ?? 0,
      })
    : null;
  const grantorName = roleFirstName(trust.grantor, tree);
  const suffix = preview?.perYear ? " a year" : "";

  return (
    <div>
      <GiftForm
        key={formKey}
        recipients={recipients}
        accounts={accounts}
        hasSpouse={ctx.isMarried}
        annualExclusionByYear={ctx.annualExclusionByYear}
        editing={null}
        planStartYear={ctx.planStartYear}
        fixedTrust={{
          id: trust.id,
          name: trust.name,
          grantor: trust.grantor,
          crummeyPowers: trust.crummeyPowers,
        }}
        agePeople={ctx.agePeople}
        onChange={(d, reason) => {
          setDraft(d);
          setBlocked(reason);
        }}
      />
      {preview ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-3">
          Uses about {usd(preview.lifetimeUsed)}
          {suffix} of {grantorName}&apos;s lifetime exemption
          {preview.annualExcluded > 0 ? `; ${usd(preview.annualExcluded)}${suffix} is covered by the annual exclusion` : ""}.
        </p>
      ) : blocked ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-3">{blocked}</p>
      ) : null}
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          disabled={!draft}
          onClick={() => {
            if (!draft) return;
            onAdd(draft);
            setFormKey((k) => k + 1);
          }}
          className={addBtn}
        >
          Add gift
        </button>
      </div>
    </div>
  );
}

function PolicyPanel({ accounts, onAdd }: { accounts: Account[]; onAdd: (accountId: string) => void }) {
  const [id, setId] = useState("");
  return (
    <div>
      <label className="block text-[12px] text-ink-3">
        Policy to transfer
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="mt-1 block w-full max-w-xs rounded border border-ink-3 bg-card px-2 py-1 text-[13px] text-ink"
        >
          <option value="">Select a policy…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {accounts.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-ink-3">No household-owned life insurance policies to transfer.</p>
      ) : null}
      <Callout>
        A policy transferred within three years of death is pulled back into the estate. This projection doesn&apos;t
        apply that rule to a transfer.
      </Callout>
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          disabled={!id}
          onClick={() => {
            onAdd(id);
            setId("");
          }}
          className={addBtn}
        >
          Add transfer
        </button>
      </div>
    </div>
  );
}

function RetitlePanel({ accounts, onAdd }: { accounts: Account[]; onAdd: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div>
      <div role="group" aria-label="Accounts to move in" className="space-y-1">
        {accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
            {a.name}
          </label>
        ))}
        {accounts.length === 0 ? <p className="text-[12px] text-ink-3">No accounts left to move in.</p> : null}
      </div>
      <Callout>
        Moves the whole account into the trust. It isn&apos;t recorded as a gift, so no exemption is used. Use a gift
        of the account to model the gift tax.
      </Callout>
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          disabled={picked.length === 0}
          onClick={() => {
            onAdd(picked);
            setPicked([]);
          }}
          className={addBtn}
        >
          {`Add ${picked.length} account${picked.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
