"use client";

import {
  emptyBusiness,
  emptyK1,
  type BusinessFacts,
  type K1Facts,
} from "@/lib/schemas/tax-return-facts";
import { entityKey, entityPath } from "@/lib/tax-returns/merge/paths";
import type { DocumentSummary } from "@/lib/tax-returns/assemble-analysis";
import type { FieldConflict, EntityCollection } from "@/lib/tax-returns/merge/types";
import type { W2Pair } from "@/lib/tax-returns/supporting-payload";
import { MoneyField } from "./money-field";
import { FieldSourceMarker } from "./field-source-marker";
import { inputBaseClassName, selectClassName } from "@/components/forms/input-styles";
import { fmtUsd } from "@/lib/tax-analysis/format";

interface Marking {
  provenance: Record<string, string>;
  conflicts: FieldConflict[];
  documents: DocumentSummary[];
}

/** Both editors' `update(index, patch)` — replace one list entry by spreading
 *  the EXISTING entity under the patch, so untouched fields (notably
 *  `entityId`) survive. */
function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/** The money-field grid both editors render inside their `EntityCard`: one
 *  labelled `MoneyField` per entry in `fields`, each with its provenance
 *  marker. */
function MoneyFieldGrid<T extends Record<string, unknown>>({
  fields,
  entity,
  markerFor,
  onChange,
}: {
  fields: Array<{ label: string; key: keyof T & string }>;
  entity: T;
  markerFor: (field: string) => React.ReactNode;
  onChange: (patch: Partial<T>) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.key} className="text-xs text-ink-2">
          {f.label}
          {markerFor(f.key)}
          <MoneyField
            value={entity[f.key] as number | null}
            onChange={(v) => onChange({ [f.key]: v } as Partial<T>)}
          />
        </label>
      ))}
    </>
  );
}

/** The card chrome both editors share: heading, remove, and the marker lookup
 *  keyed off the entity's stored identity. */
function EntityCard({
  collection,
  entity,
  title,
  marking,
  onRemove,
  children,
}: {
  collection: EntityCollection;
  entity: { entityId?: string | null; ein?: string | null; entityName?: string | null; name?: string | null };
  title: string;
  marking: Marking;
  onRemove: () => void;
  children: (markerFor: (field: string) => React.ReactNode) => React.ReactNode;
}) {
  const key = entityKey(entity);
  const markerFor = (field: string) =>
    key ? (
      <FieldSourceMarker
        path={entityPath(collection, key, field)}
        provenance={marking.provenance}
        conflicts={marking.conflicts}
        documents={marking.documents}
      />
    ) : null;

  return (
    <div className="rounded border border-hair bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-medium text-ink">{title}</h4>
        <button
          type="button"
          className="ml-auto text-xs text-ink-3 underline hover:text-crit"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      {children(markerFor)}
    </div>
  );
}

const K1_MONEY_FIELDS: Array<{ label: string; key: keyof K1Facts }> = [
  { label: "Ordinary business income (box 1)", key: "ordinaryBusinessIncome" },
  { label: "Rental income (box 2)", key: "rentalIncome" },
  { label: "Guaranteed payments (1065 box 4)", key: "guaranteedPayments" },
  { label: "Section 179 (box 11/12)", key: "section179" },
  { label: "QBI (box 17 V / box 20 Z)", key: "qbiIncome" },
];

export function K1sEditor({
  k1s,
  w2Options,
  onChange,
  ...marking
}: Marking & {
  k1s: K1Facts[];
  w2Options: W2Pair[];
  onChange: (next: K1Facts[]) => void;
}) {
  // Every edit spreads the EXISTING entity, so `entityId` survives. Re-deriving
  // a key from the submitted values would file a name correction — the
  // canonical review-form edit — under a key nothing matches.
  const update = (index: number, patch: Partial<K1Facts>) =>
    onChange(updateAt(k1s, index, patch));

  // A W-2 pair with no wages figure can't back an assignment — an option for
  // it would be selectable and a silent no-op. `wages` narrows to `number`
  // here so the option below can render its exact value.
  const wageOptions = w2Options.filter(
    (w): w is W2Pair & { wages: number } => w.wages != null,
  );

  return (
    <div className="mt-3 flex flex-col gap-2 border-l-2 border-hair pl-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">Schedule K-1s</h3>
      {k1s.map((k, i) => (
        <EntityCard
          key={k.entityId ?? `k1-${i}`}
          collection="k1s"
          entity={k}
          title={k.entityName || "Untitled entity"}
          marking={marking}
          onRemove={() => onChange(k1s.filter((_, j) => j !== i))}
        >
          {(markerFor) => (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-ink-2">
                Entity name{markerFor("entityName")}
                <input
                  className={inputBaseClassName}
                  value={k.entityName ?? ""}
                  onChange={(e) => update(i, { entityName: e.target.value || null })}
                />
              </label>
              <label className="text-xs text-ink-2">
                EIN{markerFor("ein")}
                <input
                  className={inputBaseClassName}
                  value={k.ein ?? ""}
                  onChange={(e) => update(i, { ein: e.target.value || null })}
                />
              </label>
              <label className="text-xs text-ink-2">
                Entity type{markerFor("entityType")}
                <select
                  className={selectClassName}
                  value={k.entityType ?? ""}
                  onChange={(e) =>
                    update(i, { entityType: (e.target.value || null) as K1Facts["entityType"] })
                  }
                >
                  <option value="">Not stated</option>
                  <option value="s_corp">S corporation (1120-S)</option>
                  <option value="partnership">Partnership (1065)</option>
                  <option value="estate_trust">Estate or trust (1041)</option>
                </select>
              </label>
              <MoneyFieldGrid
                fields={K1_MONEY_FIELDS}
                entity={k}
                markerFor={markerFor}
                onChange={(patch) => update(i, patch)}
              />
              {/* D10: assignment is MANUAL. No name-matching heuristic — a
                  wrong match silently changes reasonable-comp advice. */}
              <label className="text-xs text-ink-2">
                Owner W-2 wages from this entity
                <select
                  className={selectClassName}
                  value={k.w2WagesFromEntity ?? ""}
                  onChange={(e) =>
                    update(i, {
                      w2WagesFromEntity: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Not assigned</option>
                  {/* The assignment persists as an override and is never
                      re-derived from documents — remove the W-2 that backed
                      it and the stored figure has no matching option below.
                      Rendering it anyway shows the advisor what is actually
                      stored rather than silently reporting "Not assigned"
                      for a value that's still live downstream. */}
                  {k.w2WagesFromEntity != null &&
                    !wageOptions.some((w) => w.wages === k.w2WagesFromEntity) && (
                      <option value={k.w2WagesFromEntity}>
                        {fmtUsd(k.w2WagesFromEntity)} (source document removed)
                      </option>
                    )}
                  {wageOptions.map((w) => (
                    <option key={`${w.employer}-${w.wages}`} value={w.wages}>
                      {w.employer ?? "Unnamed employer"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </EntityCard>
      ))}
      <button
        type="button"
        className="self-start rounded border border-hair px-3 py-1.5 text-sm text-ink-2"
        onClick={() => onChange([...k1s, emptyK1()])}
      >
        Add K-1
      </button>
    </div>
  );
}

const BUSINESS_MONEY_FIELDS: Array<{ label: string; key: keyof BusinessFacts }> = [
  { label: "Net profit (Sch C 31)", key: "netProfit" },
  { label: "Gross receipts (Sch C 1)", key: "grossReceipts" },
  { label: "Total expenses (Sch C 28)", key: "totalExpenses" },
  { label: "Depreciation (Sch C 13)", key: "depreciation" },
];

export function BusinessesEditor({
  businesses,
  onChange,
  ...marking
}: Marking & {
  businesses: BusinessFacts[];
  onChange: (next: BusinessFacts[]) => void;
}) {
  const update = (index: number, patch: Partial<BusinessFacts>) =>
    onChange(updateAt(businesses, index, patch));

  return (
    <div className="mt-3 flex flex-col gap-2 border-l-2 border-hair pl-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-3">
        Schedule C businesses
      </h3>
      {businesses.map((b, i) => (
        <EntityCard
          key={b.entityId ?? `biz-${i}`}
          collection="businesses"
          entity={b}
          title={b.name || "Untitled business"}
          marking={marking}
          onRemove={() => onChange(businesses.filter((_, j) => j !== i))}
        >
          {(markerFor) => (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-ink-2">
                Business name{markerFor("name")}
                <input
                  className={inputBaseClassName}
                  value={b.name ?? ""}
                  onChange={(e) => update(i, { name: e.target.value || null })}
                />
              </label>
              <MoneyFieldGrid
                fields={BUSINESS_MONEY_FIELDS}
                entity={b}
                markerFor={markerFor}
                onChange={(patch) => update(i, patch)}
              />
            </div>
          )}
        </EntityCard>
      ))}
      <button
        type="button"
        className="self-start rounded border border-hair px-3 py-1.5 text-sm text-ink-2"
        onClick={() => onChange([...businesses, emptyBusiness()])}
      >
        Add business
      </button>
    </div>
  );
}
