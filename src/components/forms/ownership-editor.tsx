/**
 * Controlled ownership editor for accounts + liabilities.
 *
 * - `value` + `onChange` are the source of truth; mode is derived strictly
 *   from `value` shape (any non-canonical shape returns "custom").
 * - Sum tolerance must stay aligned with the API at src/lib/ownership.ts (0.0001).
 * - In retirement mode, multi-owner presets are hidden and the picker is
 *   locked to a single owner (matches API constraint on retirement subTypes).
 */
"use client";

import { useMemo, useState } from "react";
import type { AccountOwner } from "@/engine/ownership";
import { TrashIcon } from "@/components/icons";
import { fieldLabelClassName, selectClassName } from "./input-styles";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OwnershipEditorProps {
  familyMembers: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  entities: { id: string; name: string }[];
  value: AccountOwner[];
  onChange: (next: AccountOwner[]) => void;
  /** Required for joint-eligible accounts so the editor can offer Community
   *  Property. Liability and retirement consumers pass "jtwros" + a no-op. */
  titlingType: "jtwros" | "community_property";
  onTitlingTypeChange: (next: "jtwros" | "community_property") => void;
  retirementMode?: boolean;
  label?: string;
  /** When true, ownership is read-only — used for system-managed rows like the
   *  default Household Cash account. */
  locked?: boolean;
  /** Helper copy shown beneath the read-only summary when `locked` is true. */
  lockedReason?: string;
  /** Optional businesses that can be picked as the account's sole "owner"
   *  (sub-asset relationship — ownership is inherited from the business and
   *  `value`/`onChange` is cleared). Mutually exclusive with `value` per the API. */
  businesses?: { id: string; name: string }[];
  /** Currently-selected business parent (null = individual owners). */
  parentBusinessId?: string | null;
  /** Setter for the business parent. Required when `businesses` is non-empty. */
  onParentBusinessIdChange?: (next: string | null) => void;
  /** Noun used in the sub-asset helper text ("sub-asset of X", "sub-liability of X"). */
  childNoun?: string;
}

type OwnershipMode = "client" | "spouse" | "joint" | "community_property" | "custom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EPSILON = 0.0001;

function deriveMode(
  value: AccountOwner[],
  clientId: string | undefined,
  spouseId: string | undefined,
  titlingType: "jtwros" | "community_property",
): OwnershipMode {
  if (value.length === 1) {
    const [r] = value;
    if (r.kind === "family_member") {
      if (clientId && r.familyMemberId === clientId && Math.abs(r.percent - 1) < EPSILON) return "client";
      if (spouseId && r.familyMemberId === spouseId && Math.abs(r.percent - 1) < EPSILON) return "spouse";
    }
  }
  if (value.length === 2 && clientId && spouseId) {
    const [a, b] = value;
    const isClientA =
      a.kind === "family_member" && a.familyMemberId === clientId && Math.abs(a.percent - 0.5) < EPSILON;
    const isSpouseB =
      b.kind === "family_member" && b.familyMemberId === spouseId && Math.abs(b.percent - 0.5) < EPSILON;
    if (isClientA && isSpouseB) {
      return titlingType === "community_property" ? "community_property" : "joint";
    }
  }
  return "custom";
}

/**
 * Redistribute remaining percentage (1 - editedPct) across all other rows,
 * weighted by their current values. This is `1 - sum(others)`, not
 * lock-then-redistribute — different semantics from auto-split-percentages.ts.
 */
function balanceRemaining(rows: AccountOwner[], editedIdx: number): AccountOwner[] {
  const editedPct = rows[editedIdx].percent;
  const remaining = Math.max(0, 1 - editedPct);
  const others = rows.filter((_, i) => i !== editedIdx);
  if (others.length === 0) return rows;
  const otherSum = others.reduce((s, r) => s + r.percent, 0);
  return rows.map((r, i) => {
    if (i === editedIdx) return r;
    const weight = otherSum > EPSILON ? r.percent / otherSum : 1 / others.length;
    const next = Math.round(remaining * weight * 10000) / 10000;
    return { ...r, percent: next };
  });
}

// ─── Row inline field styles (no w-full — flex layout drives widths) ──────────

const rowFieldBase =
  "h-9 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

const rowSelectCls =
  rowFieldBase +
  " appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] " +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238b909c%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>')]";

// ─── Sub-components ────────────────────────────────────────────────────────────

interface PresetButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function PresetButton({ label, active, onClick }: PresetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-sm)] border transition-colors " +
        (active
          ? "bg-accent text-accent-on border-accent"
          : "bg-card-2 text-ink-3 border-hair hover:border-hair-2 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}

// Owner value encoding for <select> options
function ownerToSelectValue(o: AccountOwner): string {
  if (o.kind === "family_member") return `fm:${o.familyMemberId}`;
  if (o.kind === "entity") return `ent:${o.entityId}`;
  if (o.kind === "gifted_away") return `ga:${o.recipient.kind}:${o.recipient.id}`;
  return `eb:${o.externalBeneficiaryId}`;
}

function selectValueToOwner(v: string, currentPercent: number): AccountOwner {
  if (v.startsWith("ent:")) return { kind: "entity", entityId: v.slice(4), percent: currentPercent };
  const id = v.startsWith("fm:") ? v.slice(3) : v;
  return { kind: "family_member", familyMemberId: id, percent: currentPercent };
}

interface OwnerSelectProps {
  value: AccountOwner;
  idx: number;
  rowKey: string;
  familyMembers: OwnershipEditorProps["familyMembers"];
  entities: OwnershipEditorProps["entities"];
  businesses: NonNullable<OwnershipEditorProps["businesses"]>;
  onChange: (idx: number, owner: AccountOwner) => void;
  onRemove: (idx: number) => void;
  onBalance: (idx: number) => void;
  onBusinessSelect: (businessId: string) => void;
  showBalance: boolean;
}

function OwnerRow({
  value, idx, familyMembers, entities, businesses, onChange, onRemove, onBalance, onBusinessSelect, showBalance,
}: OwnerSelectProps) {
  const selectVal = ownerToSelectValue(value);
  const pctDisplay = Math.round(value.percent * 10000) / 100; // 0-100 for display

  return (
    <li className="flex items-center gap-2">
      <select
        value={selectVal}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) { onRemove(idx); return; }
          if (v.startsWith("bus:")) {
            onBusinessSelect(v.slice(4));
            return;
          }
          onChange(idx, selectValueToOwner(v, value.percent));
        }}
        className={rowSelectCls + " flex-1 min-w-0"}
        aria-label={`Owner ${idx + 1}`}
      >
        {familyMembers.length > 0 && (
          <optgroup label="Household">
            {familyMembers.map((fm) => (
              <option key={fm.id} value={`fm:${fm.id}`}>
                {fm.firstName} ({fm.role})
              </option>
            ))}
          </optgroup>
        )}
        {entities.length > 0 && (
          <optgroup label="Entity">
            {entities.map((e) => (
              <option key={e.id} value={`ent:${e.id}`}>{e.name}</option>
            ))}
          </optgroup>
        )}
        {businesses.length > 0 && (
          <optgroup label="Business">
            {businesses.map((b) => (
              <option key={b.id} value={`bus:${b.id}`}>{b.name}</option>
            ))}
          </optgroup>
        )}
      </select>

      <input
        type="number"
        step="0.01"
        min={0}
        max={100}
        value={pctDisplay}
        onChange={(e) => {
          const pct = (parseFloat(e.target.value) || 0) / 100;
          onChange(idx, { ...value, percent: pct });
        }}
        className={rowFieldBase + " w-20 text-right"}
        aria-label={`Percent ${idx + 1}`}
      />
      <span className="text-xs text-ink-3">%</span>

      {showBalance && (
        <button
          type="button"
          onClick={() => onBalance(idx)}
          className="text-xs text-ink-4 hover:text-ink whitespace-nowrap"
          title="Redistribute remaining % to other rows"
        >
          Balance remaining
        </button>
      )}

      <button
        type="button"
        onClick={() => onRemove(idx)}
        className="text-white hover:text-white"
        aria-label={`Remove owner ${idx + 1}`}
      >
        <TrashIcon className="w-4 h-4" />
      </button>
    </li>
  );
}

interface SingleOwnerPickerProps {
  value: AccountOwner[];
  familyMembers: OwnershipEditorProps["familyMembers"];
  entities: OwnershipEditorProps["entities"];
  onChange: (next: AccountOwner[]) => void;
}

function SingleOwnerPicker({ value, familyMembers, entities, onChange }: SingleOwnerPickerProps) {
  const current = value[0];
  const selectVal = current ? ownerToSelectValue(current) : "";

  return (
    <select
      value={selectVal}
      onChange={(e) => {
        if (!e.target.value) { onChange([]); return; }
        onChange([selectValueToOwner(e.target.value, 1)]);
      }}
      className={selectClassName}
      aria-label="Owner"
    >
      <option value="">— select owner —</option>
      {familyMembers.length > 0 && (
        <optgroup label="Household">
          {familyMembers.map((fm) => (
            <option key={fm.id} value={`fm:${fm.id}`}>
              {fm.firstName} ({fm.role})
            </option>
          ))}
        </optgroup>
      )}
      {entities.length > 0 && (
        <optgroup label="Entity">
          {entities.map((e) => (
            <option key={e.id} value={`ent:${e.id}`}>{e.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

function LockedOwnershipDisplay({
  familyMembers,
  entities,
  value,
  label,
  lockedReason,
}: {
  familyMembers: OwnershipEditorProps["familyMembers"];
  entities: OwnershipEditorProps["entities"];
  value: AccountOwner[];
  label: string;
  lockedReason?: string;
}) {
  const summary = value.length === 0
    ? "—"
    : value
        .map((o) => {
          const pct = Math.round(o.percent * 1000) / 10;
          let name: string;
          if (o.kind === "family_member") {
            name = familyMembers.find((fm) => fm.id === o.familyMemberId)?.firstName ?? "Family member";
          } else if (o.kind === "entity") {
            name = entities.find((e) => e.id === o.entityId)?.name ?? "Entity";
          } else {
            name = "External beneficiary";
          }
          return value.length === 1 && Math.abs(o.percent - 1) < EPSILON
            ? name
            : `${name} ${pct}%`;
        })
        .join(" · ");

  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>
      <div
        aria-readonly="true"
        className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[13px] text-ink"
      >
        {summary}
      </div>
      {lockedReason && (
        <p className="mt-1.5 text-[11px] text-ink-3">{lockedReason}</p>
      )}
    </div>
  );
}

export function OwnershipEditor({
  familyMembers,
  entities,
  value,
  onChange,
  titlingType,
  onTitlingTypeChange,
  retirementMode = false,
  label = "Owner(s)",
  locked = false,
  lockedReason,
  businesses,
  parentBusinessId = null,
  onParentBusinessIdChange,
  childNoun = "sub-asset",
}: OwnershipEditorProps) {
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const spouseFm = familyMembers.find((fm) => fm.role === "spouse");
  const businessList = businesses ?? [];
  const businessParent = parentBusinessId
    ? businessList.find((b) => b.id === parentBusinessId) ?? null
    : null;

  const derivedMode = useMemo(
    () => deriveMode(value, clientFm?.id, spouseFm?.id, titlingType),
    [value, clientFm?.id, spouseFm?.id, titlingType],
  );

  // forceCustom: true when the user explicitly clicked "Custom" while a preset
  // was active. Cleared whenever a preset button is clicked.
  const [forceCustom, setForceCustom] = useState(false);

  // Stable row keys — prevent focus loss / value flash when a non-last row is removed.
  // Initialized once from the initial value length; mutated in add/remove handlers.
  // Preset clicks reset the full value list so they reset via handler as well.
  const [rowKeys, setRowKeys] = useState<string[]>(() =>
    Array.from({ length: value.length }, () => Math.random().toString(36).slice(2)),
  );

  if (locked) {
    return (
      <LockedOwnershipDisplay
        familyMembers={familyMembers}
        entities={entities}
        value={value}
        label={label}
        lockedReason={lockedReason}
      />
    );
  }

  // Business parent overrides individual mode: there are no preset/joint
  // semantics — the account is a sub-asset of the business and owners are
  // inherited.
  const effectiveMode: OwnershipMode = businessParent
    ? "custom"
    : forceCustom
      ? "custom"
      : derivedMode;

  const sum = value.reduce((s, r) => s + r.percent, 0);
  const sumOk = value.length > 0 && Math.abs(sum - 1) < EPSILON;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function clearBusinessParent() {
    if (parentBusinessId && onParentBusinessIdChange) {
      onParentBusinessIdChange(null);
    }
  }

  function handlePresetClient() {
    if (!clientFm) return;
    setForceCustom(false);
    clearBusinessParent();
    onChange([{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }]);
  }

  function handlePresetSpouse() {
    if (!spouseFm) return;
    setForceCustom(false);
    clearBusinessParent();
    onChange([{ kind: "family_member", familyMemberId: spouseFm.id, percent: 1 }]);
  }

  function handlePresetJoint() {
    if (!clientFm || !spouseFm) return;
    setForceCustom(false);
    clearBusinessParent();
    onTitlingTypeChange("jtwros");
    onChange([
      { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
      { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
    ]);
  }

  function handlePresetCommunityProperty() {
    if (!clientFm || !spouseFm) return;
    setForceCustom(false);
    clearBusinessParent();
    onTitlingTypeChange("community_property");
    onChange([
      { kind: "family_member", familyMemberId: clientFm.id, percent: 0.5 },
      { kind: "family_member", familyMemberId: spouseFm.id, percent: 0.5 },
    ]);
  }

  function handleRowChange(idx: number, owner: AccountOwner) {
    const next = value.map((r, i) => (i === idx ? owner : r));
    onChange(next);
  }

  function handleRowRemove(idx: number) {
    setRowKeys((prev) => prev.filter((_, i) => i !== idx));
    onChange(value.filter((_, i) => i !== idx));
  }

  function handleRowBalance(idx: number) {
    onChange(balanceRemaining(value, idx));
  }

  function handleAddOwner() {
    const newRow: AccountOwner = {
      kind: "family_member",
      familyMemberId: clientFm?.id ?? (familyMembers[0]?.id ?? ""),
      percent: 0,
    };
    setRowKeys((prev) => [...prev, Math.random().toString(36).slice(2)]);
    onChange([...value, newRow]);
  }

  function handleBusinessSelect(businessId: string) {
    if (!onParentBusinessIdChange) return;
    setForceCustom(false);
    onParentBusinessIdChange(businessId);
    setRowKeys([]);
    onChange([]);
  }

  // Business sub-asset row: switching to a non-business owner clears the
  // business parent and seeds owners with a single 100% row.
  function handleBusinessRowChange(v: string) {
    if (!v) {
      clearBusinessParent();
      return;
    }
    if (v.startsWith("bus:")) {
      onParentBusinessIdChange?.(v.slice(4));
      return;
    }
    clearBusinessParent();
    const owner = selectValueToOwner(v, 1);
    setRowKeys([Math.random().toString(36).slice(2)]);
    onChange([owner]);
  }

  // ── Render: retirement mode ────────────────────────────────────────────────

  if (retirementMode) {
    return (
      <div>
        <label className={fieldLabelClassName}>{label}</label>
        <SingleOwnerPicker
          value={value}
          familyMembers={familyMembers}
          entities={entities}
          onChange={onChange}
        />
        <p className="mt-1.5 text-[11px] text-ink-3">
          IRS rules require a single owner for retirement accounts.
        </p>
      </div>
    );
  }

  // ── Render: normal mode ────────────────────────────────────────────────────

  const showSpousePresets = !!spouseFm;

  return (
    <div>
      <label className={fieldLabelClassName}>{label}</label>

      {/* Preset bar */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <PresetButton
          label={clientFm?.firstName ?? "Client"}
          active={derivedMode === "client" && !forceCustom}
          onClick={handlePresetClient}
        />
        {showSpousePresets && (
          <PresetButton
            label={spouseFm?.firstName ?? "Spouse"}
            active={derivedMode === "spouse" && !forceCustom}
            onClick={handlePresetSpouse}
          />
        )}
        {showSpousePresets && (
          <PresetButton
            label="Joint 50/50"
            active={derivedMode === "joint" && !forceCustom}
            onClick={handlePresetJoint}
          />
        )}
        {showSpousePresets && (
          <PresetButton
            label="Community Property"
            active={derivedMode === "community_property" && !forceCustom}
            onClick={handlePresetCommunityProperty}
          />
        )}
        <PresetButton
          label="Custom"
          active={forceCustom || derivedMode === "custom"}
          onClick={() => setForceCustom(true)}
        />
      </div>

      {/* Custom rows — shown when effective mode is custom */}
      {effectiveMode === "custom" && !businessParent && (
        <div>
          <ul className="space-y-2">
            {value.map((owner, idx) => (
              <OwnerRow
                key={rowKeys[idx] ?? idx}
                rowKey={rowKeys[idx] ?? String(idx)}
                value={owner}
                idx={idx}
                familyMembers={familyMembers}
                entities={entities}
                businesses={businessList}
                onChange={handleRowChange}
                onRemove={handleRowRemove}
                onBalance={handleRowBalance}
                onBusinessSelect={handleBusinessSelect}
                showBalance={value.length > 1}
              />
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleAddOwner}
              className="text-xs text-accent hover:text-accent/80"
            >
              + Add owner
            </button>
          </div>
        </div>
      )}

      {/* Business sub-asset — one row, no percent (owners inherited). */}
      {businessParent && (
        <div>
          <ul className="space-y-2">
            <li className="flex items-center gap-2">
              <select
                value={`bus:${businessParent.id}`}
                onChange={(e) => handleBusinessRowChange(e.target.value)}
                className={rowSelectCls + " flex-1 min-w-0"}
                aria-label="Owner"
              >
                {familyMembers.length > 0 && (
                  <optgroup label="Household">
                    {familyMembers.map((fm) => (
                      <option key={fm.id} value={`fm:${fm.id}`}>
                        {fm.firstName} ({fm.role})
                      </option>
                    ))}
                  </optgroup>
                )}
                {entities.length > 0 && (
                  <optgroup label="Entity">
                    {entities.map((e) => (
                      <option key={e.id} value={`ent:${e.id}`}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Business">
                  {businessList.map((b) => (
                    <option key={b.id} value={`bus:${b.id}`}>{b.name}</option>
                  ))}
                </optgroup>
              </select>
            </li>
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">
            This account will be a {childNoun} of{" "}
            <strong className="text-ink">{businessParent.name}</strong>
            . Owners are inherited from the business and cannot be set here.
          </p>
        </div>
      )}

      {/* Total indicator — hidden when business parent is active (no percents). */}
      {value.length > 0 && !businessParent && (
        <div className="mt-2 text-xs">
          {sumOk ? (
            <span className="text-ink-3">
              Total: {Math.round(sum * 1000) / 10}% ✓
            </span>
          ) : (
            <span className="text-crit">
              Total: {Math.round(sum * 1000) / 10}% (must equal 100%)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
