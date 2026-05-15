"use client";

import { useState, useMemo, useRef } from "react";
import DialogShell from "@/components/dialog-shell";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import type {
  Account,
  BeneficiaryRef,
  ClientData,
  Will,
  WillBequest,
  WillBequestRecipient,
  WillResiduaryRecipient,
} from "@/engine/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  accountId: string;
  clientData: ClientData;
  onApplyBeneficiaries: (refs: BeneficiaryRef[]) => void;
  onApplyWill: (
    willId: string,
    bequests: Will["bequests"],
    residuary: WillResiduaryRecipient[],
  ) => void;
  onClose: () => void;
}

type RouteTab = "beneficiary" | "will";

// A simplified row shape used for editing beneficiary refs in the dialog.
interface BeneficiaryRow {
  /** Stable client-side key for React rendering. */
  key: string;
  tier: "primary" | "contingent";
  percentage: number;
  recipientKind: "householdRole" | "family_member" | "external_beneficiary" | "entity";
  recipientId: string | null; // null when householdRole
  householdRole?: "client" | "spouse";
  sortOrder: number;
}

// Will-editing row for recipients on a specific bequest or residuary clause.
interface WillRecipientRow {
  key: string;
  recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

// ── Retirement detection ──────────────────────────────────────────────────────

/**
 * Retirement accounts (IRA, 401k, 403b, Roth IRA) must transfer via
 * beneficiary designation — they cannot be willed to a non-spouse beneficiary
 * under ERISA / IRC rules. We use the engine's `category === "retirement"`
 * field which covers all retirement subtypes.
 */
function isRetirementAccount(account: Account): boolean {
  return account.category === "retirement";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

let _keyCounter = 0;
function newKey(): string {
  return `k-${++_keyCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Convert engine BeneficiaryRef[] → editable BeneficiaryRow[].
 * Rows keep their sort order; new rows get a fresh key.
 */
function refsToRows(refs: BeneficiaryRef[]): BeneficiaryRow[] {
  return refs.map((ref, i) => {
    let recipientKind: BeneficiaryRow["recipientKind"];
    let recipientId: string | null = null;
    let householdRole: "client" | "spouse" | undefined = undefined;

    if (ref.householdRole) {
      recipientKind = "householdRole";
      householdRole = ref.householdRole;
    } else if (ref.entityIdRef) {
      recipientKind = "entity";
      recipientId = ref.entityIdRef;
    } else if (ref.externalBeneficiaryId) {
      recipientKind = "external_beneficiary";
      recipientId = ref.externalBeneficiaryId;
    } else if (ref.familyMemberId) {
      recipientKind = "family_member";
      recipientId = ref.familyMemberId;
    } else {
      // Malformed ref — default to family_member placeholder.
      recipientKind = "family_member";
    }

    return {
      key: newKey(),
      tier: ref.tier,
      percentage: ref.percentage,
      recipientKind,
      recipientId,
      householdRole,
      sortOrder: ref.sortOrder ?? i,
    };
  });
}

/**
 * Convert editable BeneficiaryRow[] → engine BeneficiaryRef[].
 * Generates stable ids using crypto.randomUUID if available.
 */
function rowsToRefs(rows: BeneficiaryRow[]): BeneficiaryRef[] {
  return rows.map((row, i) => {
    const base: BeneficiaryRef = {
      id: typeof crypto !== "undefined" ? crypto.randomUUID() : `ref-${i}`,
      tier: row.tier,
      percentage: row.percentage,
      sortOrder: i,
    };
    if (row.recipientKind === "householdRole" && row.householdRole) {
      return { ...base, householdRole: row.householdRole };
    }
    if (row.recipientKind === "entity" && row.recipientId) {
      return { ...base, entityIdRef: row.recipientId };
    }
    if (row.recipientKind === "external_beneficiary" && row.recipientId) {
      return { ...base, externalBeneficiaryId: row.recipientId };
    }
    if (row.recipientKind === "family_member" && row.recipientId) {
      return { ...base, familyMemberId: row.recipientId };
    }
    return base;
  });
}

/**
 * Convert engine WillBequest.recipients / WillResiduaryRecipient[] to editable rows.
 */
function willRecipientsToRows(
  recipients: Array<{
    recipientKind: "family_member" | "external_beneficiary" | "entity" | "spouse";
    recipientId: string | null;
    percentage: number;
    sortOrder: number;
  }>,
): WillRecipientRow[] {
  return recipients.map((r) => ({
    key: newKey(),
    recipientKind: r.recipientKind,
    recipientId: r.recipientId,
    percentage: r.percentage,
    sortOrder: r.sortOrder,
  }));
}

function rowsToWillRecipients(rows: WillRecipientRow[]): WillBequestRecipient[] {
  return rows.map((r, i) => ({
    recipientKind: r.recipientKind,
    recipientId: r.recipientId,
    percentage: r.percentage,
    sortOrder: i,
  }));
}

/** Clamp a percent value to [0, 100]. */
function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Number.isNaN(v) ? 0 : v));
}

/** Check if a tier's rows have percentages that sum to 100 (±0.5). */
function tierSumOk(rows: BeneficiaryRow[], tier: "primary" | "contingent"): boolean {
  const tierRows = rows.filter((r) => r.tier === tier);
  if (tierRows.length === 0) return true; // empty tier is valid
  const sum = tierRows.reduce((s, r) => s + r.percentage, 0);
  return Math.abs(sum - 100) < 0.5;
}

// ── Recipient select value helpers ────────────────────────────────────────────

function benefRowToSelectValue(row: BeneficiaryRow): string {
  if (row.recipientKind === "householdRole") return `hh:${row.householdRole ?? ""}`;
  if (row.recipientKind === "entity") return `ent:${row.recipientId ?? ""}`;
  if (row.recipientKind === "external_beneficiary") return `ext:${row.recipientId ?? ""}`;
  if (row.recipientKind === "family_member") return `fm:${row.recipientId ?? ""}`;
  return "";
}

function willRowToSelectValue(row: WillRecipientRow): string {
  if (row.recipientKind === "spouse") return "spouse";
  if (row.recipientKind === "entity") return `ent:${row.recipientId ?? ""}`;
  if (row.recipientKind === "external_beneficiary") return `ext:${row.recipientId ?? ""}`;
  if (row.recipientKind === "family_member") return `fm:${row.recipientId ?? ""}`;
  return "";
}

// ── Component ─────────────────────────────────────────────────────────────────

// Shared row input style matching owner dialog
const rowFieldBase =
  "h-9 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

const rowSelectClassName =
  rowFieldBase +
  " appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] " +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238b909c%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>')]";

export default function EstateFlowChangeDistributionDialog({
  accountId,
  clientData,
  onApplyBeneficiaries,
  onApplyWill,
  onClose,
}: Props) {
  const account = clientData.accounts.find((a) => a.id === accountId);
  // Guard: view only renders when account is found, but be safe.
  if (!account) return null;

  return (
    <EstateFlowChangeDistributionDialogInner
      account={account}
      clientData={clientData}
      onApplyBeneficiaries={onApplyBeneficiaries}
      onApplyWill={onApplyWill}
      onClose={onClose}
    />
  );
}

interface InnerProps {
  account: Account;
  clientData: ClientData;
  onApplyBeneficiaries: (refs: BeneficiaryRef[]) => void;
  onApplyWill: (
    willId: string,
    bequests: Will["bequests"],
    residuary: WillResiduaryRecipient[],
  ) => void;
  onClose: () => void;
}

function EstateFlowChangeDistributionDialogInner({
  account,
  clientData,
  onApplyBeneficiaries,
  onApplyWill,
  onClose,
}: InnerProps) {
  const isRetirement = isRetirementAccount(account);

  // Refs for keyboard-navigation focus management on the tablist.
  const tabBtnRefs = useRef<Record<RouteTab, HTMLButtonElement | null>>({
    beneficiary: null,
    will: null,
  });

  // ── Derive current route ──────────────────────────────────────────────────

  /**
   * An account "has beneficiaries" if its beneficiaries array is populated,
   * or if it's a retirement account (which always uses beneficiary designation
   * by law). When neither is true and a will bequest exists, we default to "will".
   */
  const currentRoute = useMemo((): RouteTab => {
    if (isRetirement) return "beneficiary";
    if (account.beneficiaries && account.beneficiaries.length > 0) return "beneficiary";
    // Check if any will has a specific bequest for this account.
    const wills = clientData.wills ?? [];
    for (const will of wills) {
      for (const bequest of will.bequests) {
        if (
          bequest.kind === "asset" &&
          bequest.assetMode === "specific" &&
          bequest.accountId === account.id
        ) {
          return "will";
        }
      }
    }
    // Default: beneficiary designation (even if empty, so advisor can set one).
    return "beneficiary";
  }, [isRetirement, account.beneficiaries, clientData.wills, account.id]);

  const [activeTab, setActiveTab] = useState<RouteTab>(currentRoute);

  // ── People/entity data ────────────────────────────────────────────────────

  const clientName = `${clientData.client.firstName} ${clientData.client.lastName ?? ""}`.trim();
  const spouseName = clientData.client.spouseName ?? null;
  const isMarried = !!spouseName;

  const familyMembers = useMemo(
    () => (clientData.familyMembers ?? []).filter((m) => m.role !== "client" && m.role !== "spouse"),
    [clientData.familyMembers],
  );

  const externalBeneficiaries = clientData.externalBeneficiaries ?? [];

  const entities = useMemo(
    () => (clientData.entities ?? []).filter((e) => e.entityType === "trust"),
    [clientData.entities],
  );

  // ── Will context ──────────────────────────────────────────────────────────

  /**
   * Find the will that has a specific bequest for this account (if any).
   * The bequest edit scope is: update that specific bequest's recipients.
   */
  const { willForAccount, bequestForAccount } = useMemo(() => {
    const wills = clientData.wills ?? [];
    for (const w of wills) {
      for (const b of w.bequests) {
        if (
          b.kind === "asset" &&
          b.assetMode === "specific" &&
          b.accountId === account.id
        ) {
          return { willForAccount: w, bequestForAccount: b };
        }
      }
    }
    return { willForAccount: null, bequestForAccount: null };
  }, [clientData.wills, account.id]);

  /**
   * Determine which will to use if the advisor switches to will-path and no
   * specific bequest exists yet. Use the owner's will (client or spouse).
   * Fall back to first will, or null if no wills exist.
   */
  const defaultWillForNewBequest = useMemo((): Will | null => {
    const wills = clientData.wills ?? [];
    if (wills.length === 0) return null;
    // Try to match owner
    const owner = account.owners[0];
    if (owner) {
      const ownerRole =
        owner.kind === "family_member"
          ? (clientData.familyMembers ?? []).find((m) => m.id === owner.familyMemberId)?.role
          : undefined;
      if (ownerRole === "client" || ownerRole === "spouse") {
        const w = wills.find((w) => w.grantor === ownerRole);
        if (w) return w;
      }
    }
    return wills[0];
  }, [clientData.wills, account.owners, clientData.familyMembers]);

  // ── Beneficiary tab state ─────────────────────────────────────────────────

  const [beneficiaryRows, setBeneficiaryRows] = useState<BeneficiaryRow[]>(
    () => refsToRows(account.beneficiaries ?? []),
  );

  // ── Will tab state ────────────────────────────────────────────────────────

  // Recipients on the specific bequest for this account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialWillRows = useMemo(() => willRecipientsToRows(bequestForAccount?.recipients ?? []), []);
  const [willRecipientRows, setWillRecipientRows] = useState<WillRecipientRow[]>(initialWillRows);

  const [willCondition, setWillCondition] = useState<WillBequest["condition"]>(
    bequestForAccount?.condition ?? "always",
  );

  // ── Validation ────────────────────────────────────────────────────────────

  const primaryRows = beneficiaryRows.filter((r) => r.tier === "primary");
  const contingentRows = beneficiaryRows.filter((r) => r.tier === "contingent");
  const primaryOk = tierSumOk(beneficiaryRows, "primary");
  const contingentOk = tierSumOk(beneficiaryRows, "contingent");
  const beneficiaryValid = primaryOk && contingentOk;

  const willSum = willRecipientRows.reduce((s, r) => s + r.percentage, 0);
  const willSumOk =
    willRecipientRows.length === 0 || Math.abs(willSum - 100) < 0.5;
  const willRecipientsHaveIds = willRecipientRows.every(
    (r) => r.recipientKind === "spouse" || r.recipientId != null,
  );
  const willValid =
    willSumOk &&
    willRecipientsHaveIds &&
    (willForAccount !== null || defaultWillForNewBequest !== null);

  const canApply =
    activeTab === "beneficiary" ? beneficiaryValid : willValid;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleApply() {
    if (!canApply) return;

    if (activeTab === "beneficiary") {
      onApplyBeneficiaries(rowsToRefs(beneficiaryRows));
      return;
    }

    // Will path: update the specific bequest or create a new one.
    const targetWill = willForAccount ?? defaultWillForNewBequest;
    if (!targetWill) return;

    const newRecipients = rowsToWillRecipients(willRecipientRows);

    if (bequestForAccount) {
      // Replace this bequest's recipients in-place; preserve all other bequests.
      const updatedBequests: WillBequest[] = targetWill.bequests.map((b) => {
        if (b.id === bequestForAccount.id) {
          return { ...b, recipients: newRecipients, condition: willCondition };
        }
        return b;
      });
      onApplyWill(targetWill.id, updatedBequests, targetWill.residuaryRecipients ?? []);
    } else {
      // Create a new specific bequest for this account.
      const newBequest: WillBequest = {
        id: typeof crypto !== "undefined" ? crypto.randomUUID() : `bq-${Date.now()}`,
        name: account.name,
        kind: "asset",
        assetMode: "specific",
        accountId: account.id,
        liabilityId: null,
        percentage: 100,
        condition: willCondition,
        sortOrder: targetWill.bequests.length,
        recipients: newRecipients,
      };
      onApplyWill(
        targetWill.id,
        [...targetWill.bequests, newBequest],
        targetWill.residuaryRecipients ?? [],
      );
    }
  }

  // ── Beneficiary row helpers ───────────────────────────────────────────────

  function addBeneficiaryRow(tier: "primary" | "contingent") {
    setBeneficiaryRows((prev) => [
      ...prev,
      {
        key: newKey(),
        tier,
        percentage: 0,
        recipientKind: "householdRole",
        recipientId: null,
        householdRole: isMarried ? "spouse" : "client",
        sortOrder: prev.length,
      },
    ]);
  }

  function removeBeneficiaryRow(key: string) {
    setBeneficiaryRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateBeneficiaryRow(key: string, patch: Partial<BeneficiaryRow>) {
    setBeneficiaryRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function changeBeneficiaryPct(key: string, raw: number) {
    const clamped = clampPct(raw);
    setBeneficiaryRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, percentage: clamped } : r)),
    );
  }

  function applyBeneficiarySelectValue(key: string, value: string) {
    const patch: Partial<BeneficiaryRow> = {};
    if (value === "") {
      // Blank option: clear recipient.
      patch.recipientKind = "householdRole";
      patch.recipientId = null;
      patch.householdRole = undefined;
    } else if (value.startsWith("hh:")) {
      const role = value.slice(3) as "client" | "spouse";
      patch.recipientKind = "householdRole";
      patch.householdRole = role;
      patch.recipientId = null;
    } else if (value.startsWith("fm:")) {
      patch.recipientKind = "family_member";
      patch.recipientId = value.slice(3);
      patch.householdRole = undefined;
    } else if (value.startsWith("ext:")) {
      patch.recipientKind = "external_beneficiary";
      patch.recipientId = value.slice(4);
      patch.householdRole = undefined;
    } else if (value.startsWith("ent:")) {
      patch.recipientKind = "entity";
      patch.recipientId = value.slice(4);
      patch.householdRole = undefined;
    }
    if (Object.keys(patch).length > 0) updateBeneficiaryRow(key, patch);
  }

  // ── Will row helpers ──────────────────────────────────────────────────────

  function addWillRow() {
    setWillRecipientRows((prev) => [
      ...prev,
      {
        key: newKey(),
        recipientKind: isMarried ? "spouse" : "family_member",
        recipientId: null,
        percentage: 0,
        sortOrder: prev.length,
      },
    ]);
  }

  function removeWillRow(key: string) {
    setWillRecipientRows((prev) => prev.filter((r) => r.key !== key));
  }

  function applyWillSelectValue(key: string, value: string) {
    const patch: Partial<WillRecipientRow> = {};
    if (value === "") {
      // Blank option: clear recipient.
      patch.recipientKind = "family_member";
      patch.recipientId = null;
    } else if (value === "spouse") {
      patch.recipientKind = "spouse";
      patch.recipientId = null;
    } else if (value.startsWith("fm:")) {
      patch.recipientKind = "family_member";
      patch.recipientId = value.slice(3);
    } else if (value.startsWith("ext:")) {
      patch.recipientKind = "external_beneficiary";
      patch.recipientId = value.slice(4);
    } else if (value.startsWith("ent:")) {
      patch.recipientKind = "entity";
      patch.recipientId = value.slice(4);
    }
    if (Object.keys(patch).length > 0) {
      setWillRecipientRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
      );
    }
  }

  function changeWillPct(key: string, raw: number) {
    const clamped = clampPct(raw);
    setWillRecipientRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, percentage: clamped } : r)),
    );
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderBeneficiaryTier(
    tier: "primary" | "contingent",
    tierRows: BeneficiaryRow[],
    sumOk: boolean,
  ) {
    const sum = tierRows.reduce((s, r) => s + r.percentage, 0);
    const sumId = `${tier}-sum-msg`;

    return (
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className={fieldLabelClassName + " mb-0 capitalize"}>{tier}</span>
          <span
            id={sumId}
            className={`text-[11px] ${sumOk ? "text-ink-3" : "text-crit"}`}
          >
            {tierRows.length > 0
              ? `${sum.toFixed(0)}%${!sumOk ? " — must equal 100%" : ""}`
              : "Empty — will be skipped"}
          </span>
        </div>
        <ul className="space-y-2">
          {tierRows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <select
                aria-label={`${tier} beneficiary`}
                value={benefRowToSelectValue(row)}
                onChange={(e) => applyBeneficiarySelectValue(row.key, e.target.value)}
                className={rowSelectClassName + " flex-1 min-w-0"}
              >
                <option value="">— select beneficiary —</option>
                <optgroup label="Household">
                  <option value="hh:client">{clientName} (client)</option>
                  {spouseName && (
                    <option value="hh:spouse">{spouseName} (spouse)</option>
                  )}
                </optgroup>
                {familyMembers.length > 0 && (
                  <optgroup label="Family">
                    {familyMembers.map((fm) => (
                      <option key={fm.id} value={`fm:${fm.id}`}>
                        {fm.firstName} {fm.lastName ?? ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {externalBeneficiaries.length > 0 && (
                  <optgroup label="External">
                    {externalBeneficiaries.map((x) => (
                      <option key={x.id} value={`ext:${x.id}`}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {entities.length > 0 && (
                  <optgroup label="Trusts">
                    {entities.map((e) => (
                      <option key={e.id} value={`ent:${e.id}`}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                aria-label={`${tier} percent`}
                aria-describedby={sumId}
                aria-invalid={!sumOk}
                value={row.percentage}
                onChange={(e) => { const v = parseFloat(e.target.value); changeBeneficiaryPct(row.key, Number.isNaN(v) ? row.percentage : v); }}
                className={rowFieldBase + " w-20 text-right"}
              />
              <span className="text-[12px] text-ink-3">%</span>
              <button
                type="button"
                aria-label={`Remove ${tier} beneficiary`}
                onClick={() => removeBeneficiaryRow(row.key)}
                className="text-[12px] text-ink-4 hover:text-crit transition-colors"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => addBeneficiaryRow(tier)}
          className="mt-2 text-[12px] text-accent hover:text-accent-ink"
        >
          + Add {tier}
        </button>
      </div>
    );
  }

  function renderWillTab() {
    const noWillAvailable = !willForAccount && !defaultWillForNewBequest;
    const willId = "will-sum-msg";

    if (noWillAvailable) {
      return (
        <div className="mt-4 rounded border border-hair bg-card-2 px-4 py-3 text-[13px] text-ink-3">
          No will exists for this client. Create a will first on the Wills &amp; Bequests page,
          then return here to set the distribution.
        </div>
      );
    }

    const targetWill = willForAccount ?? defaultWillForNewBequest;

    return (
      <div className="mt-4 space-y-4">
        {bequestForAccount ? (
          <p className="text-[12px] text-ink-3">
            Editing the specific bequest for this account in{" "}
            <span className="text-ink">
              {targetWill?.grantor === "client" ? clientName : spouseName ?? "Spouse"}
              &apos;s will
            </span>
            .
          </p>
        ) : (
          <p className="text-[12px] text-ink-3">
            No specific bequest exists for this account yet. Saving will create one in{" "}
            <span className="text-ink">
              {targetWill?.grantor === "client" ? clientName : spouseName ?? "Spouse"}
              &apos;s will
            </span>
            .
          </p>
        )}

        {/* Condition (only relevant when married) */}
        {isMarried && (
          <div>
            <p className={fieldLabelClassName}>Condition</p>
            <div className="flex gap-1 flex-wrap">
              {(
                [
                  { value: "always" as const, label: "Always" },
                  { value: "if_spouse_survives" as const, label: "If spouse survives" },
                  { value: "if_spouse_predeceased" as const, label: "If spouse predeceases" },
                ] satisfies Array<{ value: WillBequest["condition"]; label: string }>
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setWillCondition(opt.value)}
                  className={`rounded border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    willCondition === opt.value
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-hair bg-card-2 text-ink-2 hover:bg-card-hover"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recipients */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={fieldLabelClassName + " mb-0"}>Recipients</span>
            <span
              id={willId}
              className={`text-[11px] ${willSumOk ? "text-ink-3" : "text-crit"}`}
            >
              {willRecipientRows.length > 0
                ? `${willSum.toFixed(0)}%${!willSumOk ? " — must equal 100%" : ""}`
                : "No recipients yet"}
            </span>
          </div>
          <ul className="space-y-2">
            {willRecipientRows.map((row) => (
              <li key={row.key} className="flex items-center gap-2">
                <select
                  aria-label="Will recipient"
                  value={willRowToSelectValue(row)}
                  onChange={(e) => applyWillSelectValue(row.key, e.target.value)}
                  className={rowSelectClassName + " flex-1 min-w-0"}
                >
                  <option value="">— select recipient —</option>
                  {spouseName && (
                    <optgroup label="Household">
                      <option value="spouse">{spouseName} (spouse)</option>
                    </optgroup>
                  )}
                  {familyMembers.length > 0 && (
                    <optgroup label="Family">
                      {familyMembers.map((fm) => (
                        <option key={fm.id} value={`fm:${fm.id}`}>
                          {fm.firstName} {fm.lastName ?? ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {externalBeneficiaries.length > 0 && (
                    <optgroup label="External">
                      {externalBeneficiaries.map((x) => (
                        <option key={x.id} value={`ext:${x.id}`}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {entities.length > 0 && (
                    <optgroup label="Entity">
                      {entities.map((e) => (
                        <option key={e.id} value={`ent:${e.id}`}>
                          {e.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  aria-label="Will recipient percent"
                  aria-describedby={willId}
                  aria-invalid={!willSumOk}
                  value={row.percentage}
                  onChange={(e) => { const v = parseFloat(e.target.value); changeWillPct(row.key, Number.isNaN(v) ? row.percentage : v); }}
                  className={rowFieldBase + " w-20 text-right"}
                />
                <span className="text-[12px] text-ink-3">%</span>
                <button
                  type="button"
                  aria-label="Remove will recipient"
                  onClick={() => removeWillRow(row.key)}
                  className="text-[12px] text-ink-4 hover:text-crit transition-colors"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addWillRow}
            className="mt-2 text-[12px] text-accent hover:text-accent-ink"
          >
            + Add recipient
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Change Distribution"
      size="md"
      primaryAction={{
        label: "Apply",
        onClick: handleApply,
        disabled: !canApply,
      }}
    >
      {/* Asset summary */}
      <div className="mb-5 rounded border border-hair bg-card-2 px-4 py-3">
        <p className="text-[14px] font-medium text-ink">{account.name}</p>
        <p className="mt-0.5 text-[12px] text-ink-3">{fmt.format(account.value)}</p>
        <p className="mt-1 text-[12px] text-ink-3">
          <span className="text-ink-4">Category: </span>
          {account.category}
          {isRetirement && (
            <span className="ml-2 rounded bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-300">
              Retirement
            </span>
          )}
        </p>
      </div>

      {/* Route tabs */}
      <div>
        <div
          className="flex gap-1 mb-4"
          role="tablist"
          aria-label="Distribution method"
          onKeyDown={(e) => {
            const tabs: Array<RouteTab> = isRetirement ? ["beneficiary"] : ["beneficiary", "will"];
            const currentIndex = tabs.indexOf(activeTab);
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const delta = e.key === "ArrowRight" ? 1 : -1;
              const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
              const nextTab = tabs[nextIndex];
              setActiveTab(nextTab);
              tabBtnRefs.current[nextTab]?.focus();
            } else if (e.key === "Home") {
              e.preventDefault();
              setActiveTab(tabs[0]);
              tabBtnRefs.current[tabs[0]]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              const last = tabs[tabs.length - 1];
              setActiveTab(last);
              tabBtnRefs.current[last]?.focus();
            }
          }}
        >
          <button
            ref={(el) => { tabBtnRefs.current["beneficiary"] = el; }}
            role="tab"
            type="button"
            id="eflow-tab-beneficiary"
            aria-controls="eflow-panel-beneficiary"
            aria-selected={activeTab === "beneficiary"}
            onClick={() => setActiveTab("beneficiary")}
            className={`rounded border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === "beneficiary"
                ? "border-accent bg-accent/15 text-accent"
                : "border-hair bg-card-2 text-ink-2 hover:bg-card-hover"
            }`}
          >
            Beneficiary Designation
          </button>
          <button
            ref={(el) => { tabBtnRefs.current["will"] = el; }}
            role="tab"
            type="button"
            id="eflow-tab-will"
            aria-controls="eflow-panel-will"
            aria-selected={activeTab === "will"}
            disabled={isRetirement}
            title={
              isRetirement
                ? "Retirement accounts must use beneficiary designation — they cannot be distributed by will (ERISA / IRC)"
                : undefined
            }
            onClick={() => !isRetirement && setActiveTab("will")}
            className={`rounded border px-3 py-1.5 text-[13px] font-medium transition-colors ${
              isRetirement
                ? "cursor-not-allowed border-hair opacity-40 text-ink-2"
                : activeTab === "will"
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-hair bg-card-2 text-ink-2 hover:bg-card-hover"
            }`}
          >
            Will Bequest
            {isRetirement && (
              <span className="ml-1 text-[10px]">(N/A for retirement)</span>
            )}
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "beneficiary" && (
          <div role="tabpanel" id="eflow-panel-beneficiary" aria-labelledby="eflow-tab-beneficiary">
            <p className="text-[12px] text-ink-3 mb-1">
              Set primary and contingent beneficiaries. Each tier&apos;s percentages must sum
              to 100%.
            </p>
            {renderBeneficiaryTier("primary", primaryRows, primaryOk)}
            <div className="mt-4 border-t border-hair pt-4">
              {renderBeneficiaryTier("contingent", contingentRows, contingentOk)}
            </div>
          </div>
        )}

        {activeTab === "will" && (
          <div role="tabpanel" id="eflow-panel-will" aria-labelledby="eflow-tab-will">
            {renderWillTab()}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
