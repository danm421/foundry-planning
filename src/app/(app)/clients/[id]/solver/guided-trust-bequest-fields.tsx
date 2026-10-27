"use client";

// The "At death" form of the funding step: whose will, what it leaves, and
// when. It builds one bequest item and hands it to `onAdd`. The will-conflict
// note is read against the tree as the bequests already in the list would
// leave it, never counting the one being built.

import { useMemo, useState } from "react";
import { roleFirstName } from "@/lib/solver/trust-labels";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { FundingItem } from "@/lib/solver/guided-trust";
import { buildBequestMutations, willConflictNote } from "@/lib/solver/guided-trust-bequests";
import type { GuidedTrustContext } from "@/lib/solver/guided-trust";
import { Callout, focusRing } from "./guided-trust-ui";

type BequestItem = Extract<FundingItem, { kind: "bequest" }>;
type From = BequestItem["from"];
type Condition = BequestItem["condition"];

interface Props {
  trust: { id: string; name: string };
  ctx: GuidedTrustContext;
  /** Bequest items already in the list. */
  existing: BequestItem[];
  onAdd: (item: BequestItem) => void;
}

function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-12 shrink-0 text-[12px] text-ink-3">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors ${focusRing} ${
              value === o.value
                ? "border-accent bg-accent-wash text-ink"
                : "border-hair-2 text-ink-2 hover:border-ink-4"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GuidedTrustBequestFields({ trust, ctx, existing, onAdd }: Props) {
  const { tree, isMarried } = ctx;
  const spouseFirst = roleFirstName("spouse", tree);

  const [from, setFrom] = useState<From>("client");
  const [mode, setMode] = useState<"all_assets" | "specific">("all_assets");
  const [accountId, setAccountId] = useState("");
  const [percentText, setPercentText] = useState("100");
  const [when, setWhen] = useState<Condition>("always");

  // A business interest is ignored by a specific bequest, so it isn't offered.
  const accounts = tree.accounts.filter((a) => a.category !== "business");
  const percentage = Number(percentText);
  const percentOk = percentText.trim() !== "" && Number.isFinite(percentage) && percentage >= 1 && percentage <= 100;

  const showWhen = isMarried && from !== "second_death";
  const condition: Condition = !isMarried ? "always" : from === "second_death" ? "if_spouse_predeceased" : when;
  const ready = mode === "all_assets" || (accountId !== "" && percentOk);

  const item = useMemo<BequestItem | null>(
    () =>
      ready
        ? {
            kind: "bequest",
            from,
            condition,
            what:
              mode === "all_assets"
                ? { mode: "all_assets" }
                : { mode: "specific", accountId, percentage },
          }
        : null,
    [ready, from, condition, mode, accountId, percentage],
  );

  const note = useMemo(() => {
    if (!item) return null;
    const withOthers = applyMutations(tree, buildBequestMutations(existing, trust, tree));
    return willConflictNote(item, withOthers);
  }, [item, existing, trust, tree]);

  const fromOptions: { value: From; label: string }[] = [
    { value: "client", label: `${tree.client.firstName}'s will` },
    ...(isMarried
      ? [
          { value: "spouse" as const, label: `${spouseFirst}'s will` },
          { value: "second_death" as const, label: "Whoever dies second" },
        ]
      : []),
  ];

  return (
    <div>
      <Pills label="From" value={from} options={fromOptions} onChange={setFrom} />
      <Pills
        label="What"
        value={mode}
        options={[
          { value: "all_assets", label: "Everything" },
          { value: "specific", label: "One account" },
        ]}
        onChange={setMode}
      />
      {mode === "specific" ? (
        <div className="mb-2 ml-[60px] flex items-center gap-2">
          <select
            aria-label="Account to leave"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="block w-full max-w-[16rem] rounded border border-ink-3 bg-card px-2 py-1 text-[13px] text-ink"
          >
            <option value="">Select an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Percent of the account"
            value={percentText}
            onChange={(e) => setPercentText(e.target.value)}
            className="block w-14 rounded border border-ink-3 bg-card px-2 py-1 text-right text-[13px] text-ink tabular"
          />
          <span aria-hidden className="text-[13px] text-ink-3">
            %
          </span>
        </div>
      ) : null}
      {showWhen ? (
        <Pills
          label="When"
          value={when}
          options={[
            { value: "if_spouse_survives", label: `Only if ${spouseOrClient(from, tree.client.firstName, spouseFirst)} survives` },
            { value: "if_spouse_predeceased", label: `Only if ${spouseOrClient(from, tree.client.firstName, spouseFirst)} has already died` },
            { value: "always", label: "Either way" },
          ]}
          onChange={setWhen}
        />
      ) : null}
      {note ? <Callout>{note}</Callout> : null}
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          disabled={!item}
          onClick={() => item && onAdd(item)}
          className={`rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-on disabled:opacity-40 ${focusRing}`}
        >
          Add bequest
        </button>
      </div>
    </div>
  );
}

/** The other spouse's first name: the one whose survival the condition names. */
function spouseOrClient(from: From, clientFirst: string, spouseFirst: string): string {
  return from === "spouse" ? clientFirst : spouseFirst;
}
