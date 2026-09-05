"use client";

import { useState } from "react";
import type { getCrmHousehold } from "@/lib/crm/households";
import { ChevronRightIcon } from "@/components/icons";
import {
  DetailList,
  DetailRow,
  MetricBlock,
  SectionLabel,
  fmtMoney,
  monoLabelClass,
} from "@/components/crm-section-primitives";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;
type PlanningAccount = Household["planningAccounts"][number];
type AccountCategory = PlanningAccount["category"];

const SUBTYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage",
  savings: "Savings",
  checking: "Checking",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  "403b": "403(b)",
  "529": "529",
  trust: "Trust",
  other: "Other",
  primary_residence: "Primary Residence",
  rental_property: "Rental Property",
  commercial_property: "Commercial Property",
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  s_corp: "S Corp",
  c_corp: "C Corp",
  llc: "LLC",
  term: "Term Life",
  whole_life: "Whole Life",
  universal_life: "Universal Life",
  variable_life: "Variable Life",
};

const CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
  education_savings: "529 / Education",
};

type SectionKey = "accounts" | "real_estate" | "other";

const SECTION_TITLES: Record<SectionKey, string> = {
  accounts: "Accounts",
  real_estate: "Real Estate",
  other: "Other",
};

const SECTION_ORDER: SectionKey[] = ["accounts", "real_estate", "other"];

function sectionForCategory(category: AccountCategory): SectionKey {
  if (
    category === "taxable" ||
    category === "cash" ||
    category === "retirement" ||
    category === "education_savings"
  ) {
    return "accounts";
  }
  if (category === "real_estate") return "real_estate";
  return "other";
}

function formatOwners(owners: PlanningAccount["owners"]): string {
  if (owners.length === 0) return "—";
  if (owners.length === 1) return owners[0].name;
  return owners.map((o) => `${o.name} (${Math.round(Number(o.percent) * 100)}%)`).join(", ");
}

function AccountRow({ account }: { account: PlanningAccount }) {
  const [open, setOpen] = useState(false);
  const typeLabel =
    SUBTYPE_LABELS[account.subType] ?? CATEGORY_LABELS[account.category] ?? account.subType;
  const custodian = account.custodian?.trim() || "—";
  const last4 = account.accountNumberLast4?.trim();

  return (
    <li className="border-hair transition-colors duration-150 [&:not(:last-child)]:border-b">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-card-hover"
      >
        <ChevronRightIcon
          width={12}
          height={12}
          aria-hidden="true"
          className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="tabular w-[116px] shrink-0 text-[15px] font-bold text-ink">
          {fmtMoney(account.value)}
        </span>
        <span className="text-ink-4" aria-hidden>·</span>
        <span className="truncate text-[14px] font-medium text-ink">{account.name}</span>
        <span className="text-ink-4" aria-hidden>·</span>
        <span className={`shrink-0 ${monoLabelClass}`}>{typeLabel}</span>
        {last4 && (
          <>
            <span className="text-ink-4" aria-hidden>·</span>
            <span className="tabular shrink-0 text-[12px] text-ink-3">····{last4}</span>
          </>
        )}
      </button>

      {open && (
        <div className="border-t border-hair px-4 py-1">
          <DetailList>
            <DetailRow label="Owner" dense>
              {formatOwners(account.owners)}
            </DetailRow>
            <DetailRow label="Custodian" dense>
              {custodian}
            </DetailRow>
            <DetailRow label="Basis" dense>
              <span className="tabular">{fmtMoney(account.basis)}</span>
            </DetailRow>
          </DetailList>
        </div>
      )}
    </li>
  );
}

function AccountSection({
  title,
  items,
}: {
  title: string;
  items: PlanningAccount[];
}) {
  if (items.length === 0) return null;
  const subtotal = items.reduce((sum, a) => sum + Number(a.value || 0), 0);
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel as="h3" segments={[`${title} (${items.length})`]}>
        <span className="tabular text-[13px] font-bold text-ink-2">{fmtMoney(subtotal)}</span>
      </SectionLabel>
      <ul className="rounded-[var(--radius)] border border-hair-2 bg-card">
        {items.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </ul>
    </section>
  );
}

export function AccountsTab({ household }: { household: Household }) {
  const items = household.planningAccounts;
  const totalValue = items.reduce((sum, a) => sum + Number(a.value || 0), 0);

  if (!household.planningClient) {
    return (
      <AccountsEmpty
        headline="No planning client linked."
        detail="Accounts are sourced from this household’s planning client net worth."
      />
    );
  }

  if (items.length === 0) {
    return (
      <AccountsEmpty
        headline="No accounts on the base scenario."
        detail="Add accounts on the planning client’s net worth to see them here."
      />
    );
  }

  const grouped: Record<SectionKey, PlanningAccount[]> = {
    accounts: [],
    real_estate: [],
    other: [],
  };
  for (const a of items) grouped[sectionForCategory(a.category)].push(a);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-5 border-b border-hair-2 pb-6">
        <SectionLabel segments={["Net worth", `${items.length} records`]} />
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <MetricBlock
            label="Total"
            value={fmtMoney(totalValue)}
            support="Sourced from base scenario"
            size="lg"
          />
          <div className="flex min-w-[280px] flex-1 flex-wrap rounded-[var(--radius)] border border-hair-2">
            {SECTION_ORDER.map((key) => {
              const subtotal = grouped[key].reduce((sum, a) => sum + Number(a.value || 0), 0);
              return (
                <div
                  key={key}
                  className="min-w-0 flex-1 border-hair px-4 py-3 [&:not(:first-child)]:border-l"
                >
                  <MetricBlock
                    label={SECTION_TITLES[key]}
                    value={fmtMoney(subtotal)}
                    size="sm"
                    fillPct={totalValue > 0 ? (subtotal / totalValue) * 100 : 0}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {SECTION_ORDER.map((key) => (
        <AccountSection key={key} title={SECTION_TITLES[key]} items={grouped[key]} />
      ))}
    </div>
  );
}

function AccountsEmpty({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionLabel segments={["Net worth"]} />
      <div className="rounded-[var(--radius)] border border-dashed border-hair-2 px-6 py-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">{headline}</p>
        <p className="mt-2 text-[13px] text-ink-3">{detail}</p>
      </div>
    </div>
  );
}
