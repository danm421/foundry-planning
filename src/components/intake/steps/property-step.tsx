"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import {
  ContextualUploadZone,
  type IntakeUploadContext,
} from "@/components/intake/intake-upload-zone";
import {
  CardList,
  DecimalInput,
  MoneyInput,
  OwnerField,
  inputCls,
  labelCls,
  labelFor,
  money,
  ownerOptions,
  selectCls,
} from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PropertySlice = IntakeDraft["property"];
type PropertyItem = NonNullable<PropertySlice>[number];
type MortgageItem = NonNullable<PropertyItem["mortgage"]>;

export interface PropertyStepProps {
  value: PropertySlice;
  onChange: (next: PropertySlice) => void;
  /** Display name for the primary client (falls back to "Client"). */
  clientName?: string;
  /** Display name for the spouse (falls back to "Spouse"); omit when none. */
  spouseName?: string;
  /** When false, only the client is offered as an owner. */
  hasSpouse?: boolean;
  /** Present only on the public wizard; omit and no upload zone renders. */
  uploads?: IntakeUploadContext;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const KIND_OPTIONS = [
  { value: "real_estate", label: "Real estate" },
  { value: "business",    label: "Business interest" },
] as const;

// Property tax, insurance, and a mortgage are real-estate questions: the
// projection reads `annualPropertyTax` on real_estate accounts only, and a
// business interest carries neither a homeowner's policy nor a mortgage. A
// business interest still has a cost basis, so that one is asked either way.
//
// "real_estate" is a blank property's kind, so it's the fallback everywhere.
function isRealEstate(kind: PropertyItem["kind"] | undefined): boolean {
  return (kind ?? "real_estate") === "real_estate";
}

// ─── Blank template ──────────────────────────────────────────────────────────

function blankProperty(): PropertyItem {
  return { name: "", kind: "real_estate", value: 0, owner: "client" };
}

// ─── Summary helpers ─────────────────────────────────────────────────────────

/** "Mortgage $420,000" / "Mortgage" when the box is ticked but nothing typed. */
function mortgageLabel(mortgage: PropertyItem["mortgage"]): string | undefined {
  if (!mortgage) return undefined;
  return mortgage.balance ? `Mortgage ${money(mortgage.balance)}` : "Mortgage";
}

// ─── PropertyStep ─────────────────────────────────────────────────────────────
//
// One property is open for editing at a time; every other one collapses to a
// summary row (name · kind · owner · mortgage · value) with Edit / remove
// controls — the same shape as the Accounts and Income steps.

export function PropertyStep({
  value,
  onChange,
  clientName,
  spouseName,
  hasSpouse = false,
  uploads,
}: PropertyStepProps) {
  const property = value ?? [];
  const ownerOpts = ownerOptions({ clientName, spouseName, hasSpouse });

  const totalValue = property.reduce((sum, p) => sum + (p.value ?? 0), 0);
  const totalMortgage = property.reduce(
    (sum, p) => sum + (p.mortgage?.balance ?? 0),
    0,
  );

  function addProperty() {
    onChange([...property, blankProperty()]);
  }

  function removeProperty(index: number) {
    onChange(property.filter((_, i) => i !== index));
  }

  function updateProperty(index: number, patch: Partial<PropertyItem>) {
    onChange(property.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  /** Patch one field of a property's mortgage, creating the object if needed. */
  function updateMortgage(index: number, patch: Partial<MortgageItem>) {
    const current = property[index]?.mortgage ?? {};
    updateProperty(index, { mortgage: { ...current, ...patch } });
  }

  return (
    <div className="space-y-6">
      <CardList
        addLabel="Add property"
        emptyMessage="No property added yet"
        emptyHint="Add your home, any rental property, and business interests you own."
        items={property}
        kpis={[
          { label: "Total property value", value: money(totalValue) },
          { label: "Total mortgage balance", value: money(totalMortgage) },
        ]}
        onAdd={addProperty}
        onRemove={removeProperty}
        renderSummary={(item) => ({
          title: item.name?.trim() || "Untitled property",
          subtitle: [
            labelFor(KIND_OPTIONS, item.kind),
            labelFor(ownerOpts, item.owner),
            mortgageLabel(item.mortgage),
          ]
            .filter(Boolean)
            .join(" · "),
          amount: item.value,
        })}
        renderItem={(item, i) => {
          const idp = `property-${i}`;
          const realEstate = isRealEstate(item.kind);
          const hasMortgage = item.mortgage != null;
          return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Name */}
              <div className="sm:col-span-2">
                <label htmlFor={`${idp}-name`} className={labelCls}>
                  Description
                </label>
                <input
                  id={`${idp}-name`}
                  type="text"
                  className={inputCls}
                  value={item.name ?? ""}
                  onChange={(e) => updateProperty(i, { name: e.target.value })}
                  placeholder="e.g. Main residence"
                  aria-label="Description"
                />
              </div>

              {/* Kind */}
              <div>
                <label htmlFor={`${idp}-kind`} className={labelCls}>
                  Kind
                </label>
                <select
                  id={`${idp}-kind`}
                  className={selectCls}
                  value={item.kind ?? "real_estate"}
                  onChange={(e) => {
                    const kind = e.target.value as PropertyItem["kind"];
                    updateProperty(i, {
                      kind,
                      // Drop the real-estate-only answers when the kind no longer
                      // asks for them, so hidden fields can't submit stale numbers.
                      ...(isRealEstate(kind)
                        ? {}
                        : {
                            annualPropertyTax: undefined,
                            annualInsurance: undefined,
                            mortgage: undefined,
                          }),
                    });
                  }}
                  aria-label="Kind"
                >
                  {KIND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Owner */}
              <OwnerField
                id={`${idp}-owner`}
                value={item.owner}
                options={ownerOpts}
                onChange={(owner) => updateProperty(i, { owner })}
              />

              {/* Value */}
              <div>
                <label htmlFor={`${idp}-value`} className={labelCls}>
                  Estimated value
                </label>
                <MoneyInput
                  id={`${idp}-value`}
                  value={item.value}
                  onChange={(num) => updateProperty(i, { value: num })}
                  ariaLabel="Estimated value"
                  placeholder="0"
                />
              </div>

              {/* Cost basis */}
              <div>
                <label htmlFor={`${idp}-basis`} className={labelCls}>
                  Cost basis
                  <span className="ml-1 font-normal normal-case text-ink-4">
                    (optional)
                  </span>
                </label>
                <MoneyInput
                  id={`${idp}-basis`}
                  value={item.basis}
                  onChange={(num) => updateProperty(i, { basis: num })}
                  ariaLabel="Cost basis"
                  placeholder="What you paid, plus improvements"
                />
              </div>

              {/* Property tax + insurance — real estate only */}
              {realEstate && (
                <>
                  <div>
                    <label htmlFor={`${idp}-annualPropertyTax`} className={labelCls}>
                      Property taxes
                      <span className="ml-1 font-normal normal-case text-ink-4">
                        (per year)
                      </span>
                    </label>
                    <MoneyInput
                      id={`${idp}-annualPropertyTax`}
                      value={item.annualPropertyTax}
                      onChange={(num) => updateProperty(i, { annualPropertyTax: num })}
                      ariaLabel="Annual property taxes"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label htmlFor={`${idp}-annualInsurance`} className={labelCls}>
                      Insurance
                      <span className="ml-1 font-normal normal-case text-ink-4">
                        (per year)
                      </span>
                    </label>
                    <MoneyInput
                      id={`${idp}-annualInsurance`}
                      value={item.annualInsurance}
                      onChange={(num) => updateProperty(i, { annualInsurance: num })}
                      ariaLabel="Annual insurance"
                      placeholder="0"
                    />
                  </div>

                  {/* ── Mortgage ─────────────────────────────────────────── */}
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-[14px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={hasMortgage}
                        onChange={(e) =>
                          // Unchecking drops the whole object, so a hidden
                          // mortgage can never be submitted.
                          updateProperty(i, {
                            mortgage: e.target.checked ? {} : undefined,
                          })
                        }
                        className="h-4 w-4 shrink-0 rounded border-hair bg-card-2 text-accent focus:ring-1 focus:ring-accent"
                      />
                      There&apos;s a mortgage on this property
                    </label>
                  </div>

                  {hasMortgage && (
                    <div className="grid grid-cols-1 gap-4 rounded-[var(--radius-sm)] border border-hair bg-card-2 p-4 sm:col-span-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor={`${idp}-mortgage-balance`} className={labelCls}>
                          Balance remaining
                        </label>
                        <MoneyInput
                          id={`${idp}-mortgage-balance`}
                          value={item.mortgage?.balance}
                          onChange={(num) => updateMortgage(i, { balance: num })}
                          ariaLabel="Mortgage balance remaining"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label htmlFor={`${idp}-mortgage-years`} className={labelCls}>
                          Years remaining
                        </label>
                        <DecimalInput
                          id={`${idp}-mortgage-years`}
                          value={item.mortgage?.yearsRemaining}
                          onChange={(num) => updateMortgage(i, { yearsRemaining: num })}
                          ariaLabel="Years remaining on the mortgage"
                          placeholder="e.g. 22"
                          suffix="years"
                        />
                      </div>

                      <div>
                        <label htmlFor={`${idp}-mortgage-rate`} className={labelCls}>
                          Interest rate
                        </label>
                        <DecimalInput
                          id={`${idp}-mortgage-rate`}
                          value={item.mortgage?.interestRatePct}
                          onChange={(num) => updateMortgage(i, { interestRatePct: num })}
                          ariaLabel="Mortgage interest rate"
                          placeholder="e.g. 6.5"
                          suffix="%"
                        />
                      </div>

                      <div>
                        <label htmlFor={`${idp}-mortgage-payment`} className={labelCls}>
                          Monthly payment
                        </label>
                        <MoneyInput
                          id={`${idp}-mortgage-payment`}
                          value={item.mortgage?.monthlyPayment}
                          onChange={(num) => updateMortgage(i, { monthlyPayment: num })}
                          ariaLabel="Monthly mortgage payment"
                          placeholder="0"
                        />
                        <p className="mt-1 text-[12px] text-ink-3">
                          Principal and interest only — leave out taxes and insurance.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        }}
      />

      <ContextualUploadZone
        uploads={uploads}
        docType="mortgage"
        label="Upload a mortgage statement or property tax bill"
      />
    </div>
  );
}
