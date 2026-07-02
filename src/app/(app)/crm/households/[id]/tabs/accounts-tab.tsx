"use client";

import { useState } from "react";
import type { getCrmHousehold } from "@/lib/crm/households";
import { ChevronRightIcon } from "@/components/icons";

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

function fmtMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
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
    <li className="rounded-[var(--radius)] border border-hair bg-card transition-colors hover:border-hair-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronRightIcon
          width={12}
          height={12}
          aria-hidden="true"
          className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-[15px] font-semibold tabular-nums text-ink">
          {fmtMoney(account.value)}
        </span>
        <span className="text-ink-3" aria-hidden>·</span>
        <span className="truncate text-[14px] font-medium text-ink">{account.name}</span>
        <span className="text-ink-3" aria-hidden>·</span>
        <span className="text-[13px] text-ink-3">{typeLabel}</span>
        {last4 && (
          <>
            <span className="text-ink-3" aria-hidden>·</span>
            <span className="font-mono text-[12px] text-ink-3">····{last4}</span>
          </>
        )}
      </button>

      {open && (
        <dl className="grid grid-cols-1 gap-y-1 border-t border-hair px-4 py-3 text-[12.5px] text-ink-2 sm:grid-cols-[110px_1fr] sm:gap-x-3">
          <dt className="text-ink-3">Owner</dt>
          <dd>{formatOwners(account.owners)}</dd>

          <dt className="text-ink-3">Custodian</dt>
          <dd>{custodian}</dd>

          <dt className="text-ink-3">Basis</dt>
          <dd className="tabular-nums">{fmtMoney(account.basis)}</dd>
        </dl>
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
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          {title} ({items.length})
        </h3>
        <div className="text-[12px] text-ink-3">
          <span className="font-semibold tabular-nums text-ink-2">{fmtMoney(String(subtotal))}</span>
        </div>
      </div>
      <ul className="space-y-2.5">
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
      <div className="space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Accounts
        </h2>
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
          <p className="text-[13px] text-ink-3">No planning client linked.</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Accounts are sourced from this household&rsquo;s planning client net worth.
          </p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Accounts
        </h2>
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
          <p className="text-[13px] text-ink-3">No accounts on the base scenario.</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Add accounts on the planning client&rsquo;s net worth to see them here.
          </p>
        </div>
      </div>
    );
  }

  const grouped: Record<SectionKey, PlanningAccount[]> = {
    accounts: [],
    real_estate: [],
    other: [],
  };
  for (const a of items) grouped[sectionForCategory(a.category)].push(a);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[1.2px] text-ink-2">
          Net Worth ({items.length})
        </h2>
        <div className="text-[12px] text-ink-3">
          Total{" "}
          <span className="font-semibold tabular-nums text-ink">{fmtMoney(String(totalValue))}</span>
        </div>
      </div>

      {SECTION_ORDER.map((key) => (
        <AccountSection key={key} title={SECTION_TITLES[key]} items={grouped[key]} />
      ))}
    </div>
  );
}
