"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { USPS_STATE_NAMES, USPS_STATE_CODES } from "@/lib/usps-states";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FamilySlice = IntakeDraft["family"];

type PersonPartial = NonNullable<NonNullable<FamilySlice>["primary"]>;
type ChildPartial = NonNullable<NonNullable<FamilySlice>["children"]>[number];

export interface FamilyStepProps {
  value: FamilySlice;
  onChange: (next: FamilySlice) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MARITAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Select…" },
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

// ─── Shared input styles (design-system token classes) ───────────────────────
const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent";
const labelCls = "block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3 mb-1";
const selectCls = inputCls;

// ─── PersonFields sub-component ───────────────────────────────────────────────

interface PersonFieldsProps {
  idPrefix: string;
  value: PersonPartial;
  onChange: (patch: PersonPartial) => void;
  showMaritalStatus?: boolean;
}

function PersonFields({ idPrefix, value, onChange, showMaritalStatus = true }: PersonFieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* First name */}
      <div>
        <label htmlFor={`${idPrefix}-firstName`} className={labelCls}>
          First name
        </label>
        <input
          id={`${idPrefix}-firstName`}
          type="text"
          className={inputCls}
          value={value.firstName ?? ""}
          onChange={(e) => onChange({ ...value, firstName: e.target.value })}
          autoComplete="given-name"
          aria-label="First name"
        />
      </div>

      {/* Last name */}
      <div>
        <label htmlFor={`${idPrefix}-lastName`} className={labelCls}>
          Last name
        </label>
        <input
          id={`${idPrefix}-lastName`}
          type="text"
          className={inputCls}
          value={value.lastName ?? ""}
          onChange={(e) => onChange({ ...value, lastName: e.target.value })}
          autoComplete="family-name"
          aria-label="Last name"
        />
      </div>

      {/* Date of birth */}
      <div>
        <label htmlFor={`${idPrefix}-dob`} className={labelCls}>
          Date of birth
        </label>
        <input
          id={`${idPrefix}-dob`}
          type="date"
          className={`${inputCls} tabular`}
          value={value.dateOfBirth ?? ""}
          onChange={(e) => onChange({ ...value, dateOfBirth: e.target.value })}
          aria-label="Date of birth"
        />
      </div>

      {/* Marital status */}
      {showMaritalStatus && (
        <div>
          <label htmlFor={`${idPrefix}-maritalStatus`} className={labelCls}>
            Marital status
          </label>
          <select
            id={`${idPrefix}-maritalStatus`}
            className={selectCls}
            value={value.maritalStatus ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                maritalStatus: e.target.value as PersonPartial["maritalStatus"] || undefined,
              })
            }
            aria-label="Marital status"
          >
            {MARITAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ─── ChildCard sub-component ─────────────────────────────────────────────────

interface ChildCardProps {
  index: number;
  value: ChildPartial;
  onChange: (patch: ChildPartial) => void;
  onRemove: () => void;
}

function ChildCard({ index, value, onChange, onRemove }: ChildCardProps) {
  const idPrefix = `child-${index}`;
  return (
    <div className="relative rounded-[var(--radius-sm)] border border-hair bg-card-2 p-4">
      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-hair hover:text-crit"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
        <span className="sr-only">Remove child {index + 1}</span>
      </button>

      <p className={`${labelCls} mb-3`}>Child {index + 1}</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* First name */}
        <div>
          <label htmlFor={`${idPrefix}-firstName`} className={labelCls}>
            First name
          </label>
          <input
            id={`${idPrefix}-firstName`}
            type="text"
            className={inputCls}
            value={value.firstName ?? ""}
            onChange={(e) => onChange({ ...value, firstName: e.target.value })}
            aria-label="First name"
          />
        </div>

        {/* Last name (optional) */}
        <div>
          <label htmlFor={`${idPrefix}-lastName`} className={labelCls}>
            Last name
            <span className="ml-1 font-normal text-ink-4">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-lastName`}
            type="text"
            className={inputCls}
            value={value.lastName ?? ""}
            onChange={(e) => onChange({ ...value, lastName: e.target.value || undefined })}
            aria-label="Last name"
          />
        </div>

        {/* Date of birth */}
        <div>
          <label htmlFor={`${idPrefix}-dob`} className={labelCls}>
            Date of birth
          </label>
          <input
            id={`${idPrefix}-dob`}
            type="date"
            className={`${inputCls} tabular`}
            value={value.dateOfBirth ?? ""}
            onChange={(e) => onChange({ ...value, dateOfBirth: e.target.value })}
            aria-label="Date of birth"
          />
        </div>
      </div>
    </div>
  );
}

// ─── FamilyStep ───────────────────────────────────────────────────────────────

export function FamilyStep({ value, onChange }: FamilyStepProps) {
  const family = value ?? {};
  const primary = family.primary ?? {};
  const children = family.children ?? [];
  const hasSpouse = family.spouse !== undefined && family.spouse !== null;

  function setPrimary(patch: PersonPartial) {
    onChange({ ...family, primary: patch });
  }

  function setSpouse(patch: PersonPartial | null) {
    onChange({ ...family, spouse: patch ?? undefined });
  }

  function setStateOfResidence(code: string) {
    onChange({ ...family, stateOfResidence: code || undefined });
  }

  function addChild() {
    const newChild: ChildPartial = { firstName: "", dateOfBirth: "" };
    onChange({ ...family, children: [...children, newChild] });
  }

  function updateChild(index: number, patch: ChildPartial) {
    const next = children.map((c, i) => (i === index ? patch : c));
    onChange({ ...family, children: next });
  }

  function removeChild(index: number) {
    const next = children.filter((_, i) => i !== index);
    onChange({ ...family, children: next });
  }

  function toggleSpouse() {
    if (hasSpouse) {
      setSpouse(null);
    } else {
      setSpouse({ firstName: "", lastName: "", dateOfBirth: "" });
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Primary client ─────────────────────────────────────────────── */}
      <section aria-labelledby="primary-heading">
        <h2
          id="primary-heading"
          className="mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
        >
          About you
        </h2>
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <PersonFields
            idPrefix="primary"
            value={primary}
            onChange={setPrimary}
            showMaritalStatus
          />
        </div>
      </section>

      {/* ── State of residence ─────────────────────────────────────────── */}
      <section aria-labelledby="state-heading">
        <h2
          id="state-heading"
          className="mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
        >
          Residence
        </h2>
        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <div className="max-w-xs">
            <label htmlFor="stateOfResidence" className={labelCls}>
              State of residence
            </label>
            <select
              id="stateOfResidence"
              className={selectCls}
              value={family.stateOfResidence ?? ""}
              onChange={(e) => setStateOfResidence(e.target.value)}
              aria-label="State of residence"
            >
              <option value="">Select a state…</option>
              {USPS_STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {USPS_STATE_NAMES[code]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Spouse ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="spouse-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="spouse-heading"
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
          >
            Spouse or partner
            <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
          </h2>
          <button
            type="button"
            onClick={toggleSpouse}
            className={
              hasSpouse
                ? "text-[13px] text-ink-3 underline underline-offset-2 hover:text-crit"
                : "rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
            }
          >
            {hasSpouse ? "Remove spouse" : "Add spouse"}
          </button>
        </div>

        {hasSpouse && (
          <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
            <PersonFields
              idPrefix="spouse"
              value={family.spouse ?? {}}
              onChange={(patch) => setSpouse(patch)}
              showMaritalStatus={false}
            />
          </div>
        )}
      </section>

      {/* ── Children ───────────────────────────────────────────────────── */}
      <section aria-labelledby="children-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="children-heading"
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3"
          >
            Children
            <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
          </h2>
          <button
            type="button"
            onClick={addChild}
            className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
          >
            Add child
          </button>
        </div>

        {children.length > 0 && (
          <div className="space-y-3">
            {children.map((child, i) => (
              <ChildCard
                key={i}
                index={i}
                value={child}
                onChange={(patch) => updateChild(i, patch)}
                onRemove={() => removeChild(i)}
              />
            ))}
          </div>
        )}

        {children.length === 0 && (
          <p className="text-[13px] text-ink-4">
            No children added yet.
          </p>
        )}
      </section>
    </div>
  );
}
