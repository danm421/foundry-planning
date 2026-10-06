import type { ClientData, ClientInfo, EntitySummary } from "@/engine/types";
import type { SavingsGrowthSource, SolverMutation, SolverPerson } from "@/lib/solver/types";
import type { DebtPaydownRow } from "@/lib/solver/debt-paydown";
import { stressParamsFromMutation } from "@/lib/solver/stress-test-mutations";
import { usd as money } from "@/lib/solver/technique-summaries";
import { stressTestName } from "@/lib/stress-tests/describe";
import { ltcPersonFirstName } from "@/lib/ltc/ltc-event-name";
import { CO_CLIENT_LABEL, type IndividualOwner } from "@/lib/owner-labels";
import { INCOME_TAX_TYPE_LABELS } from "./solver-income-edit-dialog";

/** What a change line needs to name things the way the rest of the app does. */
export interface MutationNames {
  client: ClientInfo;
  /** Display name by row id. A savings rule reads as the account it funds. */
  rows: ReadonlyMap<string, string>;
}

/** Names from the plan the Solver started from AND its working copy, so a row
 *  the advisor removed still reads by name. The working copy goes last: a row
 *  renamed in the Solver shows its new name. */
export function mutationNames(source: ClientData, working: ClientData): MutationNames {
  const rows = new Map<string, string>();
  for (const t of [source, working]) {
    for (const r of [
      ...t.accounts,
      ...t.incomes,
      ...t.expenses,
      ...t.liabilities,
      ...(t.entities ?? []),
      ...(t.rothConversions ?? []),
      ...(t.assetTransactions ?? []),
      ...(t.reinvestments ?? []),
      ...(t.relocations ?? []),
      ...(t.externalBeneficiaries ?? []),
      ...(t.notesReceivable ?? []),
    ]) {
      if (r.name) rows.set(r.id, r.name);
    }
  }
  for (const r of [...source.savingsRules, ...working.savingsRules]) {
    const account = rows.get(r.accountId);
    if (account) rows.set(r.id, account);
  }
  return { client: working.client, rows };
}

/** decimal → "23%" / "3.5%" — at most two decimals. */
const pct = (d: number) => `${Number((d * 100).toFixed(2))}%`;

const growsWith = (source: SavingsGrowthSource) =>
  source === "inflation" ? "grows with inflation" : "grows at a custom rate";

const span = (start: number, end: number) => (start === end ? `in ${start}` : `${start}–${end}`);

function paydown(p: DebtPaydownRow): string {
  if (p.frequency === "one_time") return `${money(p.amount)} in ${p.startYear}`;
  const per = p.frequency === "monthly" ? "/mo" : "/yr";
  return `${money(p.amount)}${per} ${span(p.startYear, p.endYear)}`;
}

/** The SS dialog's own option names, lower-cased to sit mid-sentence. */
const CLAIM_AGE_MODE = {
  fra: "full retirement age",
  at_retirement: "at retirement",
  years: "a specific age",
} as const;

const BENEFIT_MODE = {
  pia_at_fra: "from PIA",
  manual_amount: "an annual amount",
  no_benefit: "no benefit",
} as const;

/** The stored enum is `client`/`spouse`/`joint`; the advisor never sees those
 *  words anywhere else in the app. `joint` is carried for the wider grantor
 *  enum the gift mutations use — a will's own grantor is only the first two. */
const GRANTOR_LABEL: Record<IndividualOwner, string> = {
  client: "Client",
  spouse: CO_CLIENT_LABEL,
  joint: "Joint",
};

/** `entityType` is a seven-member union. A foundation is neither a trust nor a
 *  business, so it gets its own word rather than falling into the else. */
function entityKindLabel(entityType: EntitySummary["entityType"]): string {
  if (entityType === "foundation") return "Foundation";
  return entityType === "trust" || entityType == null ? "Trust" : "Business";
}

/** One plain-words line per Solver change for the "Save as scenario" dialog —
 *  names and first names, never a row id or a mutation kind. Exhaustive on
 *  purpose: a new kind fails the type check until it has a line. */
export function describeSolverMutation(m: SolverMutation, names: MutationNames): string {
  const who = (p: SolverPerson) => ltcPersonFirstName(p, names.client);
  const named = (noun: string, id: string) => {
    const name = names.rows.get(id);
    return name ? `${noun}: ${name}` : noun;
  };
  const removed = (noun: string, id: string) => `Removed ${named(noun, id)}`;

  switch (m.kind) {
    case "retirement-age":
      return `Retirement age (${who(m.person)}) → ${m.age}${m.month ? ` (month ${m.month})` : ""}`;
    case "living-expense-scale":
      return `Living expenses scaled × ${m.multiplier.toFixed(2)}`;
    case "living-expense-amount":
      return `Retirement living expense → ${money(m.amount)}/yr`;
    case "expense-annual-amount":
      return `${named("Expense", m.expenseId)} → ${money(m.annualAmount)}/yr`;
    case "expense-absorbs-remaining":
      return m.value
        ? "Current living expenses spend whatever's left"
        : "Current living expenses use a fixed amount";
    case "income-annual-amount":
      return `${named("Income", m.incomeId)} → ${money(m.annualAmount)}/yr`;
    case "income-growth-rate":
      return `${named("Income", m.incomeId)} grows ${pct(m.rate)} a year`;
    case "income-growth-source":
      return `${named("Income", m.incomeId)} ${growsWith(m.source)}`;
    case "income-tax-type":
      return `${named("Income", m.incomeId)} taxed as ${INCOME_TAX_TYPE_LABELS[m.taxType]}`;
    case "income-self-employment":
      return `${named("Income", m.incomeId)} ${m.value ? "is" : "is not"} self-employment income`;
    case "income-start-year":
      return `${named("Income", m.incomeId)} starts ${m.year}`;
    case "income-end-year":
      return `${named("Income", m.incomeId)} ends ${m.year}`;
    case "ss-claim-age":
      return `SS claim age (${who(m.person)}) → ${m.age}${
        m.months ? ` and ${m.months} month${m.months === 1 ? "" : "s"}` : ""
      }`;
    case "ss-claim-age-mode":
      return `SS claim age (${who(m.person)}) → ${CLAIM_AGE_MODE[m.mode]}`;
    case "ss-benefit-mode":
      return `SS benefit (${who(m.person)}) → ${BENEFIT_MODE[m.mode]}`;
    case "ss-pia-monthly":
      return `SS PIA (${who(m.person)}) → ${money(m.amount)}/mo`;
    case "ss-annual-amount":
      return `SS benefit (${who(m.person)}) → ${money(m.amount)}/yr`;
    case "ss-cola":
      return `SS cost-of-living raise (${who(m.person)}) → ${pct(m.rate)} a year`;
    case "savings-contribution":
      return `${named("Savings", m.accountId)} → ${money(m.annualAmount)}/yr`;
    case "savings-annual-percent":
      return `${named("Savings", m.accountId)} → ${
        m.percent == null ? "a fixed amount" : `${pct(m.percent)} of salary`
      }`;
    case "savings-salary-basis": {
      const salaries = m.incomeIds.flatMap((id) => names.rows.get(id) ?? []);
      const basis =
        m.basis === "all"
          ? "all salaries"
          : m.basis === "selected" && salaries.length > 0
            ? salaries.join(", ")
            : "the owner's salary";
      return `${named("Savings", m.accountId)} → percent of ${basis}`;
    }
    case "savings-roth-percent":
      return `${named("Savings", m.accountId)} → ${pct(m.rothPercent)} Roth`;
    case "savings-contribute-max":
      return `${named("Savings", m.accountId)} → ${m.value ? "the IRS maximum" : "a set amount"}`;
    case "savings-growth-rate":
      return `${named("Savings", m.accountId)} grows ${pct(m.rate)} a year`;
    case "savings-growth-source":
      return `${named("Savings", m.accountId)} ${growsWith(m.source)}`;
    case "savings-deductible":
      return `${named("Savings", m.accountId)} ${m.value ? "is" : "is not"} deductible`;
    case "savings-apply-cap":
      return `${named("Savings", m.accountId)} ${m.value ? "is" : "is not"} held to the IRS limit`;
    case "savings-employer-match-pct":
      return `${named("Savings", m.accountId)} → employer match ${pct(m.pct)}${
        m.cap != null ? ` on ${pct(m.cap)} of salary` : ""
      }`;
    case "savings-employer-match-amount":
      return `${named("Savings", m.accountId)} → employer match ${money(m.amount)}/yr`;
    case "savings-start-year":
      return `${named("Savings", m.accountId)} starts ${m.year}`;
    case "savings-end-year":
      return `${named("Savings", m.accountId)} ends ${m.year}`;
    case "life-expectancy":
      return `Life expectancy (${who(m.person)}) → ${m.age}`;
    case "roth-conversion-upsert":
      return m.value ? `Roth conversion: ${m.value.name}` : removed("a Roth conversion", m.id);
    case "asset-transaction-upsert":
      return m.value
        ? `${m.value.type === "buy" ? "Purchase" : "Sale"} in ${m.value.year}: ${m.value.name}`
        : removed("an asset transaction", m.id);
    case "reinvestment-upsert":
      return m.value
        ? `Reinvestment in ${m.value.year}: ${m.value.name}`
        : removed("a reinvestment", m.id);
    case "relocation-upsert":
      return m.value ? `Move in ${m.value.year}: ${m.value.name}` : removed("a move", m.id);
    case "debt-paydown": {
      const loan = names.rows.get(m.liabilityId) ?? "a loan";
      return m.value
        ? `Extra payments on ${loan}: ${paydown(m.value)}`
        : `Removed extra payments on ${loan}`;
    }
    // ── Estate / trust editor ────────────────────────────────────────────────
    case "entity-upsert":
      if (!m.value) return removed("a trust or business", m.id);
      return `${entityKindLabel(m.value.entityType)}: ${m.value.name ?? names.rows.get(m.id) ?? "unnamed"}`;
    case "account-upsert":
      return m.value ? `Account: ${m.value.name}` : removed("an account", m.id);
    case "liability-upsert":
      return m.value ? `Liability: ${m.value.name}` : removed("a liability", m.id);
    case "income-upsert":
      return m.value
        ? `Income: ${m.value.name} → ${money(m.value.annualAmount)}/yr`
        : removed("an income", m.id);
    case "expense-upsert":
      return m.value
        ? `Expense: ${m.value.name} → ${money(m.value.annualAmount)}/yr`
        : removed("an expense", m.id);
    case "savings-rule-upsert":
      return m.value ? named("Savings", m.value.accountId) : removed("a savings contribution", m.id);
    case "external-beneficiary-upsert":
      return m.value
        ? `${m.value.kind === "charity" ? "Charity" : "Beneficiary"}: ${m.value.name}`
        : removed("a beneficiary", m.id);
    case "entity-flow-override-upsert": {
      const trust = names.rows.get(m.entityId);
      const line = `${m.value ? "Trust flows" : "Cleared trust flows"} for ${m.year}`;
      return trust ? `${line}: ${trust}` : line;
    }
    case "note-receivable-upsert":
      return m.value ? `Promissory note: ${m.value.name}` : removed("a promissory note", m.id);
    case "will-upsert":
      return m.value ? `Will (${GRANTOR_LABEL[m.value.grantor]})` : "Removed a will";
    case "gift-upsert":
      if (!m.value) return "Removed a planned gift";
      return m.value.kind === "series"
        ? `Planned gift series ${m.value.startYear}–${m.value.endYear}`
        : `Planned gift in ${m.value.year}`;
    // ── Stress tests ─────────────────────────────────────────────────────────
    // The same title the saved stressor carries on the Changes tab.
    case "stress-inflation":
    case "stress-ss-haircut":
    case "stress-disability":
    case "stress-market-crash":
    case "stress-exemption-cap":
    case "stress-tax-rates":
      return stressTestName(stressParamsFromMutation(m), names.client);
    case "stress-ltc":
      return m.value ? m.value.name : "Removed the long-term care event";
    case "surplus-allocation":
      return `Surplus: spend ${Math.round(m.spendPct * 100)}% of cash flow`;
  }
}
