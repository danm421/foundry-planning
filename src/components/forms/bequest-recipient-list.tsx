"use client";

import { fieldLabelClassName } from "./input-styles";
import type {
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
  WillRecipientKind,
} from "@/components/wills-panel";

export interface BequestRecipient {
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

interface BequestRecipientListProps {
  /** "asset" → all four kinds. "debt" → family + entity only (engine drops the others as warnings). */
  mode: "asset" | "debt";
  rows: BequestRecipient[];
  onChange: (rows: BequestRecipient[]) => void;
  primary: WillsPanelPrimary;
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
}

// Same visual base as BeneficiaryRowList — h-9 chip-style field that drops `w-full`
// so the row's flex layout can drive widths.
const rowFieldBase =
  "h-9 rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 text-[14px] text-ink outline-none " +
  "hover:border-hair-2 focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

const rowSelectClassName =
  rowFieldBase + " appearance-none pr-8 bg-no-repeat bg-[right_0.5rem_center] " +
  "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238b909c%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>')]";

const SPOUSE_VALUE = "spouse";

function rowToValue(r: BequestRecipient): string {
  if (r.recipientKind === "spouse") return SPOUSE_VALUE;
  if (r.recipientId == null) return "";
  if (r.recipientKind === "family_member") return `fm:${r.recipientId}`;
  if (r.recipientKind === "external_beneficiary") return `ext:${r.recipientId}`;
  return `ent:${r.recipientId}`;
}

function valueToFields(v: string): { recipientKind: WillRecipientKind; recipientId: string | null } | null {
  if (v === "") return null;
  if (v === SPOUSE_VALUE) return { recipientKind: "spouse", recipientId: null };
  if (v.startsWith("fm:")) return { recipientKind: "family_member", recipientId: v.slice(3) };
  if (v.startsWith("ext:")) return { recipientKind: "external_beneficiary", recipientId: v.slice(4) };
  if (v.startsWith("ent:")) return { recipientKind: "entity", recipientId: v.slice(4) };
  return null;
}

function familyLabel(f: WillsPanelFamilyMember): string {
  return `${f.firstName}${f.lastName ? " " + f.lastName : ""}`;
}

function spouseLabel(p: WillsPanelPrimary): string {
  return p.spouseName ? `${p.spouseName} (spouse)` : "Spouse";
}

export default function BequestRecipientList({
  mode,
  rows,
  onChange,
  primary,
  familyMembers,
  externalBeneficiaries,
  entities,
}: BequestRecipientListProps) {
  const sum = rows.reduce((acc, r) => acc + (Number.isFinite(r.percentage) ? r.percentage : 0), 0);
  const sumOk = rows.length === 0 || Math.abs(sum - 100) <= 0.01;

  function update(idx: number, patch: Partial<BequestRecipient>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, sortOrder: i })));
  }
  function add() {
    const next: BequestRecipient = mode === "asset"
      ? { recipientKind: "spouse", recipientId: null, percentage: 0, sortOrder: rows.length }
      : familyMembers.length > 0
        ? { recipientKind: "family_member", recipientId: familyMembers[0].id, percentage: 0, sortOrder: rows.length }
        : entities.length > 0
          ? { recipientKind: "entity", recipientId: entities[0].id, percentage: 0, sortOrder: rows.length }
          : { recipientKind: "family_member", recipientId: null, percentage: 0, sortOrder: rows.length };
    onChange([...rows, next]);
  }

  const showSpouse = mode === "asset" && primary.spouseName != null;
  const showExternal = mode === "asset";

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={fieldLabelClassName}>Recipients</span>
        <span className={sumOk ? "text-xs text-emerald-400" : "text-xs text-amber-400"}>
          sum: {sum.toFixed(2)}%
        </span>
      </div>
      <ul className="mt-1 space-y-2">
        {rows.map((r, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <select
              aria-label={`Recipient ${idx + 1}`}
              value={rowToValue(r)}
              onChange={(e) => {
                const fields = valueToFields(e.target.value);
                if (fields) update(idx, fields);
              }}
              className={rowSelectClassName + " flex-1 min-w-0"}
            >
              <option value="">— select recipient —</option>
              {showSpouse && (
                <optgroup label="Household">
                  <option value={SPOUSE_VALUE}>{spouseLabel(primary)}</option>
                </optgroup>
              )}
              {familyMembers.length > 0 && (
                <optgroup label="Family">
                  {familyMembers.map((f) => (
                    <option key={f.id} value={`fm:${f.id}`}>{familyLabel(f)}</option>
                  ))}
                </optgroup>
              )}
              {showExternal && externalBeneficiaries.length > 0 && (
                <optgroup label="External">
                  {externalBeneficiaries.map((x) => (
                    <option key={x.id} value={`ext:${x.id}`}>{x.name}</option>
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
            <input
              type="number"
              aria-label={`Percent ${idx + 1}`}
              min={0}
              max={100}
              step={0.01}
              value={r.percentage}
              onChange={(e) => update(idx, { percentage: parseFloat(e.target.value) || 0 })}
              className={rowFieldBase + " w-20 text-right"}
            />
            <span className="text-xs text-ink-3">%</span>
            <button
              type="button"
              aria-label={`Remove recipient ${idx + 1}`}
              onClick={() => remove(idx)}
              className="text-xs text-ink-4 hover:text-red-400"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        className="mt-2 text-xs text-blue-400 hover:text-blue-300"
      >
        + Add recipient
      </button>
    </div>
  );
}
