"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Account, ClientData } from "@/engine/types";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import type { SplitInterestFundingPickerAccount } from "@/components/forms/split-interest-funding-picker";
import type { SplitInterestFundingPick } from "@/lib/forms/split-interest-funding-diff";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import { buildSplitInterestSnapshot } from "@/lib/solver/split-interest-levers";
import CrtDetailsSection from "@/components/forms/crt-details-section";
import CltDetailsSection from "@/components/forms/clt-details-section";
import type { SplitInterestAnswers } from "@/lib/solver/guided-trust";
import { roleFirstName } from "@/lib/solver/trust-labels";

const inputClassName =
  "mt-1 h-9 w-full rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

/** One-line owner label for the funding picker — mirrors add-trust-form.tsx. */
function ownerSummary(owners: Account["owners"]): string {
  if (owners.length === 1) {
    const o = owners[0];
    const pct = Math.round((o.percent ?? 1) * 100);
    return o.kind === "family_member" ? `Family ${pct}%` : `Entity ${pct}%`;
  }
  return `${owners.length} owners`;
}

interface Props {
  /** Working tree (accounts, familyMembers, externalBeneficiaries, planSettings). */
  clientData: ClientData;
  subType: "crt" | "clt";
  isMarried: boolean;
  grantor: "client" | "spouse";
  onGrantorChange: (next: "client" | "spouse") => void;
  /** Seeds the form on mount; later edits stay local and are reported via onChange. */
  value: SplitInterestAnswers | null;
  /** Complete answers, or null while they are not complete yet. */
  onChange: (next: SplitInterestAnswers | null) => void;
  /** Extra controls under the payout and funding section (the CLT's remainder). */
  children?: ReactNode;
}

type PendingCharity = NonNullable<SplitInterestAnswers["newCharity"]>;

export function SolverSplitInterestForm({
  clientData,
  subType,
  isMarried,
  grantor,
  onGrantorChange,
  value,
  onChange,
  children,
}: Props) {
  const planStartYear = clientData.planSettings.planStartYear;

  const [splitInput, setSplitInput] = useState<TrustSplitInterestInput>(() => {
    const snap = value?.snapshot;
    return {
      origin: "new",
      inceptionYear: snap?.inceptionYear ?? planStartYear,
      inceptionValue: 0,
      payoutType: snap?.payoutType ?? "unitrust",
      payoutPercent: snap ? (snap.payoutPercent ?? undefined) : 0.05,
      payoutAmount: snap?.payoutAmount ?? undefined,
      irc7520Rate: snap?.irc7520Rate ?? 0.04,
      termType: snap?.termType ?? "years",
      termYears: snap ? (snap.termYears ?? undefined) : 20,
      measuringLife1Id: snap?.measuringLife1Id ?? undefined,
      measuringLife2Id: snap?.measuringLife2Id ?? undefined,
      charityId: snap?.charityId ?? "",
    };
  });
  const [fundingPicks, setFundingPicks] = useState<SplitInterestFundingPick[]>(
    () =>
      value?.fundingPicks ??
      (value?.fundingAccountIds ?? []).map((accountId) => ({ kind: "asset", accountId, percent: 1 })),
  );
  // A charity typed in here is only held; the wizard's Add trust creates it.
  const [pendingCharity, setPendingCharity] = useState<PendingCharity | null>(
    value?.newCharity ?? null,
  );

  // Inline "add charity" mini-form.
  const [charityName, setCharityName] = useState("");
  const [charityType, setCharityType] = useState<"public" | "private">("public");

  const familyMembers = useMemo(
    () =>
      (clientData.familyMembers ?? []).map((m) => ({
        id: m.id,
        firstName: m.firstName,
        dateOfBirth: m.dateOfBirth,
      })),
    [clientData.familyMembers],
  );

  const charities = useMemo(
    () => [
      ...(clientData.externalBeneficiaries ?? [])
        .filter((b) => b.kind === "charity")
        .map((b) => ({ id: b.id, name: b.name })),
      ...(pendingCharity ? [{ id: pendingCharity.id, name: `${pendingCharity.name} (new)` }] : []),
    ],
    [clientData.externalBeneficiaries, pendingCharity],
  );

  // Eligible funding accounts — mirrors add-trust-form.tsx create-mode filtering:
  // exclude retirement subtypes, the default-checking account, and anything
  // already pinned to another entity.
  const fundingAccounts = useMemo<SplitInterestFundingPickerAccount[]>(
    () =>
      clientData.accounts
        .filter((a) => {
          if (a.subType && (RETIREMENT_SUBTYPES as readonly string[]).includes(a.subType))
            return false;
          if (a.isDefaultChecking) return false;
          const pinnedToOther = a.owners.some(
            (o) => o.kind === "entity" && (o.percent ?? 0) > 0,
          );
          if (pinnedToOther) return false;
          return true;
        })
        .map((a) => ({
          id: a.id,
          name: a.name,
          subType: a.subType,
          ownerSummary: ownerSummary(a.owners),
          value: a.value,
        })),
    [clientData.accounts],
  );

  // inceptionValue is derived from funding picks (`fundingTotal`); the stored copy
  // is kept at 0 so `fundingTotal` is the single source of truth — `apply()` and
  // `sectionValue` both override it. Compute it from the picks:
  // Σ(asset.value × pct) + Σ(cash.amount), then feed it into the section so its
  // deduction preview stays in sync. This avoids a setState-in-effect sync loop.
  const fundingTotal = useMemo(
    () =>
      fundingPicks.reduce((sum, p) => {
        if (p.kind === "asset") {
          const acct = fundingAccounts.find((a) => a.id === p.accountId);
          return acct ? sum + acct.value * p.percent : sum;
        }
        return sum + p.amount;
      }, 0),
    [fundingPicks, fundingAccounts],
  );

  const sectionValue = useMemo(
    () => ({ ...splitInput, inceptionValue: fundingTotal }),
    [splitInput, fundingTotal],
  );

  // A partial percentage only scales the deduction preview — the funding mutation
  // retitles the whole account. Flag it so the user isn't misled.
  const hasPartialAssetPick = fundingPicks.some(
    (p) => p.kind === "asset" && p.percent < 1,
  );
  // The solver funds a split-interest trust by retitling accounts; a cash pick has
  // no account to retitle, so it raises the deduction/remainder-gift estimate
  // without putting any corpus in the trust (the engine reads corpus from owned
  // accounts). Warn rather than silently project a corpus-less trust. Funding the
  // corpus from cash picks is tracked as future work.
  const hasCashPick = fundingPicks.some((p) => p.kind === "cash");

  function addCharity() {
    const trimmed = charityName.trim();
    if (!trimmed) return;
    const id = crypto.randomUUID();
    setPendingCharity({ id, name: trimmed, charityType });
    setSplitInput((prev) => ({ ...prev, charityId: id }));
    setCharityName("");
  }

  function ageAt(memberId: string | undefined): number | undefined {
    if (!memberId) return undefined;
    const m = familyMembers.find((f) => f.id === memberId);
    if (!m?.dateOfBirth) return undefined;
    return splitInput.inceptionYear - parseInt(m.dateOfBirth.slice(0, 4), 10);
  }

  const blockedReason = !splitInput.charityId
    ? "Select (or add) a remainder charity."
    : fundingPicks.length === 0
      ? "Select at least one funding source."
      : null;

  const answers = useMemo<SplitInterestAnswers | null>(() => {
    if (blockedReason) return null;
    const snapshot = buildSplitInterestSnapshot(
      { ...splitInput, inceptionValue: fundingTotal },
      subType,
      { age1: ageAt(splitInput.measuringLife1Id), age2: ageAt(splitInput.measuringLife2Id) },
    );
    return {
      snapshot,
      fundingAccountIds: fundingPicks.flatMap((p) => (p.kind === "asset" ? [p.accountId] : [])),
      fundingPicks,
      newCharity: pendingCharity && pendingCharity.id === splitInput.charityId ? pendingCharity : null,
    };
    // ageAt reads splitInput and familyMembers, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockedReason, splitInput, fundingTotal, subType, fundingPicks, pendingCharity, familyMembers]);

  // Report whenever the content changes (stable JSON key, callback held in a ref
  // so a fresh parent identity does not re-fire).
  const answersJson = useMemo(
    () => (answers ? JSON.stringify(answers) : `blocked:${blockedReason}`),
    [answers, blockedReason],
  );
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current(answers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answersJson keys both
  }, [answersJson]);

  const Section = subType === "crt" ? CrtDetailsSection : CltDetailsSection;

  // Who gives and the new-charity field share one row; the payout and funding
  // section keeps the full width so its funding picker can show account names.
  return (
    <div className="space-y-3">
      <div className="grid items-end gap-x-4 gap-y-3 lg:grid-cols-2">
        {isMarried && (
          <label className="block text-[12px] text-ink-2">
            Grantor
            <select
              value={grantor}
              onChange={(e) => onGrantorChange(e.target.value as "client" | "spouse")}
              className={inputClassName}
            >
              <option value="client">{roleFirstName("client", clientData)}</option>
              <option value="spouse">{roleFirstName("spouse", clientData)}</option>
            </select>
          </label>
        )}

        {/* Inline "add charity" — makes a new charity available as the remainder. */}
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-[12px] text-ink-2">
            New charity
            <input
              type="text"
              value={charityName}
              onChange={(e) => setCharityName(e.target.value)}
              placeholder="Charity name"
              className={inputClassName}
            />
          </label>
          <select
            aria-label="Charity type"
            value={charityType}
            onChange={(e) => setCharityType(e.target.value as "public" | "private")}
            className="h-9 rounded-md border border-hair-2 bg-card px-2.5 text-[14px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
          <button
            type="button"
            onClick={addCharity}
            className="h-9 rounded-md border border-hair-2 bg-card px-3 text-[13px] text-ink hover:border-accent"
          >
            Add
          </button>
        </div>
      </div>

      <Section
        value={sectionValue}
        // Strip the derived inceptionValue so stored state stays canonical
        // (fundingTotal is the single source of truth — see sectionValue/apply()).
        onChange={(next) => setSplitInput({ ...next, inceptionValue: 0 })}
        familyMembers={familyMembers}
        charities={charities}
        fundingAccounts={fundingAccounts}
        fundingPicks={fundingPicks}
        onFundingPicksChange={setFundingPicks}
        defaultGrantor={grantor}
        hideOrigin
      />

      {hasPartialAssetPick && (
        <p className="text-[12px] text-ink-3">
          Partial percentages affect the deduction estimate only; the full account
          is retitled into the trust.
        </p>
      )}

      {hasCashPick && (
        <p className="text-[12px] text-crit">
          Cash contributions raise the deduction estimate but aren&apos;t yet funded
          into the trust corpus — its payouts and termination won&apos;t project.
          Fund with an account instead.
        </p>
      )}

      {children}

      {blockedReason && <p className="text-[12px] text-ink-3">{blockedReason}</p>}
    </div>
  );
}
