"use client";

import { Fragment } from "react";
import {
  INTAKE_SS_CLAIMING_AGES,
  type IntakeDraft,
  type IntakeSocialSecurity,
} from "@/lib/intake/schema";
import { incomeSpanLabel } from "@/lib/intake/income-years";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import {
  ContextualUploadZone,
  type IntakeUploadContext,
} from "@/components/intake/intake-upload-zone";
import {
  CardList,
  MoneyInput,
  OwnerField,
  SectionHeading,
  StepCard,
  YearInput,
  inputCls,
  labelCls,
  labelFor,
  money,
  ownerOptions,
  selectCls,
} from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type IncomeSlice = IntakeDraft["income"];
type IncomeItem = NonNullable<IncomeSlice>[number];

export interface IncomeStepProps {
  value: IncomeSlice;
  onChange: (next: IncomeSlice) => void;
  socialSecurity: IntakeSocialSecurity | undefined;
  onSocialSecurityChange: (next: IntakeSocialSecurity) => void;
  /** Display name for the primary client (falls back to "Client"). */
  clientName?: string;
  /** Display name for the co-client (falls back to "Co-client"); omit when none. */
  spouseName?: string;
  /** When false, only the client is offered as an owner. */
  hasSpouse?: boolean;
  /** Present only on the public wizard; omit and no upload zone renders. */
  uploads?: IntakeUploadContext;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "salary",           label: "Salary / wages" },
  { value: "social_security",  label: "Social Security" },
  { value: "business",         label: "Business income" },
  { value: "other",            label: "Other" },
] as const;

// Social Security has its own section below the list, so a new row isn't
// offered it — only a row already saved as Social Security keeps the option.
function typeOptionsFor(item: IncomeItem) {
  return item.type === "social_security"
    ? TYPE_OPTIONS
    : TYPE_OPTIONS.filter((opt) => opt.value !== "social_security");
}

// ─── Blank template ──────────────────────────────────────────────────────────

function blankIncome(currentYear: number): IncomeItem {
  return {
    name: "",
    type: "salary",
    annualAmount: 0,
    owner: "client",
    startYear: currentYear,
    endsAtRetirement: false,
  };
}

// ─── IncomeStep ───────────────────────────────────────────────────────────────
//
// One income source is open for editing at a time; every other one collapses to
// a summary row (name · type · owner · span · annual amount) with Edit / remove
// controls — the same shape as the Accounts step.

export function IncomeStep({
  value,
  onChange,
  socialSecurity,
  onSocialSecurityChange,
  clientName,
  spouseName,
  hasSpouse = false,
  uploads,
}: IncomeStepProps) {
  const income = value ?? [];
  const ownerOpts = ownerOptions({ clientName, spouseName, hasSpouse });

  // Read per render, not once at module load: a cached year would hydrate
  // against a different one across a New Year boundary, and would seed new rows
  // with last year in a session left open overnight.
  const currentYear = new Date().getFullYear();
  const total = income.reduce((sum, item) => sum + (item.annualAmount ?? 0), 0);

  function addIncome() {
    onChange([...income, blankIncome(currentYear)]);
  }

  function removeIncome(index: number) {
    onChange(income.filter((_, i) => i !== index));
  }

  function updateIncome(index: number, patch: Partial<IncomeItem>) {
    onChange(income.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-6">
      <CardList
        addLabel="Add income"
        emptyMessage="No income sources added yet"
        emptyHint="Add salary, business, and any other income."
        items={income}
        kpis={[
          { label: "Total annual income", value: money(total) },
          { label: "Income sources", value: String(income.length) },
        ]}
        onAdd={addIncome}
        onRemove={removeIncome}
        renderSummary={(item) => ({
          title: item.name?.trim() || "Untitled income",
          subtitle: `${labelFor(TYPE_OPTIONS, item.type)} · ${labelFor(ownerOpts, item.owner)} · ${incomeSpanLabel(item, currentYear)}`,
          amount: item.annualAmount,
        })}
        renderItem={(item, i) => {
          const idp = `income-${i}`;
          const endsAtRetirement = item.endsAtRetirement ?? false;
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
                  onChange={(e) => updateIncome(i, { name: e.target.value })}
                  placeholder="e.g. Salary at Acme Corp"
                  aria-label="Description"
                />
              </div>

              {/* Type */}
              <div>
                <label htmlFor={`${idp}-type`} className={labelCls}>
                  Type
                </label>
                <select
                  id={`${idp}-type`}
                  className={selectCls}
                  value={item.type ?? "salary"}
                  onChange={(e) =>
                    updateIncome(i, { type: e.target.value as IncomeItem["type"] })
                  }
                  aria-label="Type"
                >
                  {typeOptionsFor(item).map((opt) => (
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
                onChange={(owner) => updateIncome(i, { owner })}
              />

              {/* Amount · Starts · Ends — one line */}
              <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
                <div>
                  <label htmlFor={`${idp}-annualAmount`} className={labelCls}>
                    Annual amount
                  </label>
                  <MoneyInput
                    id={`${idp}-annualAmount`}
                    value={item.annualAmount}
                    onChange={(num) => updateIncome(i, { annualAmount: num })}
                    ariaLabel="Annual amount"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label htmlFor={`${idp}-startYear`} className={labelCls}>
                    Starts
                  </label>
                  <YearInput
                    id={`${idp}-startYear`}
                    value={item.startYear}
                    onChange={(year) => updateIncome(i, { startYear: year })}
                    ariaLabel="Start year"
                    placeholder={String(currentYear)}
                  />
                </div>

                <div>
                  <label htmlFor={`${idp}-endYear`} className={labelCls}>
                    Ends
                  </label>
                  <div className="flex items-center gap-2">
                    <YearInput
                      id={`${idp}-endYear`}
                      value={item.endYear}
                      onChange={(year) => updateIncome(i, { endYear: year })}
                      ariaLabel="End year"
                      placeholder={endsAtRetirement ? "—" : "Plan end"}
                      disabled={endsAtRetirement}
                    />
                    <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={endsAtRetirement}
                        onChange={(e) =>
                          updateIncome(i, {
                            endsAtRetirement: e.target.checked,
                            // Drop a year the row no longer ends on, so a disabled
                            // field can't submit a stale one.
                            ...(e.target.checked ? { endYear: undefined } : {}),
                          })
                        }
                        className="h-4 w-4 shrink-0 rounded border-hair bg-card-2 text-accent focus:ring-1 focus:ring-accent"
                      />
                      Retirement
                    </label>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />

      <SocialSecuritySection
        value={socialSecurity}
        onChange={onSocialSecurityChange}
        people={ownerOpts.filter(
          (o): o is { value: "client" | "spouse"; label: string } => o.value !== "joint",
        )}
      />

      <ContextualUploadZone
        uploads={uploads}
        docType="paystub"
        label="Or upload a pay stub or W-2"
      />
    </div>
  );
}

// ─── Social Security ──────────────────────────────────────────────────────────
//
// One row per person rather than a card in the list above: everyone has exactly
// one benefit, and the two numbers an advisor needs — the monthly amount off the
// SSA statement (at any age they name), and when they plan to start — fit on a
// single line. Both are optional; "Not sure" is a real answer here.

type SsOwner = keyof IntakeSocialSecurity;

const colHeadCls = "text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3";

function SocialSecuritySection({
  value,
  onChange,
  people,
}: {
  value: IntakeSocialSecurity | undefined;
  onChange: (next: IntakeSocialSecurity) => void;
  people: { value: SsOwner; label: string }[];
}) {
  function update(owner: SsOwner, patch: NonNullable<IntakeSocialSecurity[SsOwner]>) {
    onChange({ ...value, [owner]: { ...value?.[owner], ...patch } });
  }

  return (
    <section aria-labelledby="income-ss-heading" className="space-y-3">
      <SectionHeading id="income-ss-heading">Social Security</SectionHeading>
      <StepCard>
        {/* Name | benefit | start age on one line; on a phone the name takes its
            own line above the two fields, which would otherwise be too narrow
            to show "Not sure". */}
        <div className="grid grid-cols-2 items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)]">
          <span aria-hidden="true" className="hidden sm:block" />
          <span className={`${colHeadCls} flex items-center gap-1.5 self-end`}>
            Monthly benefit
            <FieldTooltip text="The monthly amount your Social Security statement shows. Most statements list it at 62, at full retirement age, and at 70 — enter any one and tell us which age." />
          </span>
          <span className={`${colHeadCls} self-end`}>Start age</span>

          {people.map(({ value: owner, label }) => {
            const answer = value?.[owner];
            return (
              <Fragment key={owner}>
                <span className="col-span-2 truncate text-[14px] font-medium text-ink sm:col-span-1">
                  {label}
                </span>
                <div className="flex flex-col gap-1">
                  <MoneyInput
                    id={`ss-${owner}-pia`}
                    value={answer?.piaMonthly}
                    onChange={(num) => update(owner, { piaMonthly: num })}
                    ariaLabel={`${label} monthly benefit at 67`}
                    placeholder="0"
                  />
                  <select
                    id={`ss-${owner}-benefit-age`}
                    className={selectCls}
                    value={answer?.benefitAge ?? ""}
                    onChange={(e) =>
                      update(owner, {
                        benefitAge: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    aria-label={`${label} benefit is at age`}
                  >
                    <option value="">at full retirement age</option>
                    {INTAKE_SS_CLAIMING_AGES.map((age) => (
                      <option key={age} value={age}>
                        at {age}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  id={`ss-${owner}-age`}
                  className={`${selectCls} tabular`}
                  value={answer?.claimingAge ?? ""}
                  onChange={(e) =>
                    update(owner, {
                      claimingAge: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  aria-label={`${label} start age`}
                >
                  <option value="">Not sure</option>
                  {INTAKE_SS_CLAIMING_AGES.map((age) => (
                    <option key={age} value={age}>
                      {age}
                    </option>
                  ))}
                </select>
              </Fragment>
            );
          })}
        </div>
      </StepCard>
    </section>
  );
}
