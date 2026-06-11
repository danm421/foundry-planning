"use client";

import { useMemo, useState } from "react";
import type { Account, ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { TrustSplitInterestInput } from "@/lib/schemas/trust-split-interest";
import type { SplitInterestFundingPickerAccount } from "@/components/forms/split-interest-funding-picker";
import type { SplitInterestFundingPick } from "@/lib/forms/split-interest-funding-diff";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import { buildRetitleFundingMutation } from "@/lib/solver/trust-levers";
import {
  buildSplitInterestSnapshot,
  buildSplitInterestTrustEntity,
  buildCltRemainderGiftMutation,
} from "@/lib/solver/split-interest-levers";
import CrtDetailsSection from "@/components/forms/crt-details-section";
import CltDetailsSection from "@/components/forms/clt-details-section";
import type { SolverTrustDraft } from "./solver-trust-form";

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
  /** Emits an external-beneficiary-upsert for a new charity; returns its id. */
  onCreateCharity: (name: string, charityType: "public" | "private") => string;
  /** Ordered primitive mutations to emit (entity first) + the draft. */
  onApply: (mutations: SolverMutation[], draft: SolverTrustDraft) => void;
  onClose: () => void;
}

export function SolverSplitInterestForm({
  clientData,
  subType,
  isMarried,
  onCreateCharity,
  onApply,
  onClose,
}: Props) {
  const planStartYear = clientData.planSettings.planStartYear;

  const [name, setName] = useState(
    subType === "crt" ? "Charitable Remainder Trust" : "Charitable Lead Trust",
  );
  const [grantor, setGrantor] = useState<"client" | "spouse">("client");
  const [splitInput, setSplitInput] = useState<TrustSplitInterestInput>({
    origin: "new",
    inceptionYear: planStartYear,
    inceptionValue: 0,
    payoutType: "unitrust",
    payoutPercent: 0.05,
    irc7520Rate: 0.04,
    termType: "years",
    termYears: 20,
    charityId: "",
  });
  const [fundingPicks, setFundingPicks] = useState<SplitInterestFundingPick[]>([]);
  const [hint, setHint] = useState<string | null>(null);

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
    () =>
      (clientData.externalBeneficiaries ?? [])
        .filter((b) => b.kind === "charity")
        .map((b) => ({ id: b.id, name: b.name })),
    [clientData.externalBeneficiaries],
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
    const id = onCreateCharity(trimmed, charityType);
    setSplitInput((prev) => ({ ...prev, charityId: id }));
    setCharityName("");
  }

  function ageAt(memberId: string | undefined): number | undefined {
    if (!memberId) return undefined;
    const m = familyMembers.find((f) => f.id === memberId);
    if (!m?.dateOfBirth) return undefined;
    return splitInput.inceptionYear - parseInt(m.dateOfBirth.slice(0, 4), 10);
  }

  function apply() {
    if (!name.trim()) return setHint("Enter a trust name.");
    if (!splitInput.charityId) return setHint("Select (or add) a remainder charity.");
    if (fundingPicks.length === 0) return setHint("Select at least one funding source.");
    setHint(null);

    const age1 = ageAt(splitInput.measuringLife1Id);
    const age2 = ageAt(splitInput.measuringLife2Id);

    const entityId = crypto.randomUUID();
    // Use the derived funding total for the frozen inceptionValue.
    const snapshot = buildSplitInterestSnapshot(
      { ...splitInput, inceptionValue: fundingTotal },
      subType,
      { age1, age2 },
    );
    const entity = buildSplitInterestTrustEntity({
      id: entityId,
      name: name.trim(),
      subType,
      grantor,
      splitInterest: snapshot,
    });

    const mutations: SolverMutation[] = [
      { kind: "entity-upsert", id: entityId, value: entity },
    ];

    // CLT: record the remainder-interest gift to heirs at inception.
    let remainderGiftId: string | undefined;
    if (subType === "clt") {
      remainderGiftId = crypto.randomUUID();
      mutations.push(
        buildCltRemainderGiftMutation(entityId, snapshot, grantor, remainderGiftId),
      );
    }

    // Funding: retitle each picked asset account into the trust. Cash picks have
    // no account to retitle, so they're skipped for funding emission (they still
    // counted toward inceptionValue). Whole-account retitle is the solver's
    // funding model (same as the 3a IDGT path).
    const fundedOriginals: Account[] = [];
    for (const pick of fundingPicks) {
      if (pick.kind !== "asset") continue;
      const account = clientData.accounts.find((a) => a.id === pick.accountId);
      if (!account) continue;
      mutations.push(buildRetitleFundingMutation(account, entityId));
      fundedOriginals.push(account);
    }

    onApply(mutations, { entity, fundedOriginals, remainderGiftId });
    onClose();
  }

  const Section = subType === "crt" ? CrtDetailsSection : CltDetailsSection;

  return (
    <div className="space-y-3">
      <label className="block text-[12px] text-ink-2">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClassName}
        />
      </label>

      {isMarried && (
        <label className="block text-[12px] text-ink-2">
          Grantor
          <select
            value={grantor}
            onChange={(e) => setGrantor(e.target.value as "client" | "spouse")}
            className={inputClassName}
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
          </select>
        </label>
      )}

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

      {/* Inline "add charity" — makes a new charity available as the remainder. */}
      <div className="flex items-end gap-2">
        <label className="flex-1 text-[12px] text-ink-2">
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

      {hint && <p className="text-[12px] text-crit">{hint}</p>}

      <button
        type="button"
        onClick={apply}
        className="h-9 rounded-md bg-accent px-3 text-[13px] text-white hover:bg-accent/90"
      >
        Add trust
      </button>
    </div>
  );
}
