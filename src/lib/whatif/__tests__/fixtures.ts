// src/lib/whatif/__tests__/fixtures.ts
//
// The engine's shared fixture, re-keyed to UUIDs: SOLVER_MUTATION_SCHEMA
// requires uuid ids on income, expense and savings levers, and the shared
// fixture uses readable ids like "acct-401k". Adds a child and a charity so
// gift changes have recipients.
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { ClientData } from "@/engine/types";
import { resolveRefYears } from "@/lib/year-refs";

export const IDS = {
  k401: "11111111-1111-4111-8111-111111111101",
  roth: "11111111-1111-4111-8111-111111111102",
  brokerage: "11111111-1111-4111-8111-111111111103",
  savings: "11111111-1111-4111-8111-111111111104",
  home: "11111111-1111-4111-8111-111111111105",
  salaryJohn: "11111111-1111-4111-8111-111111111111",
  salaryJane: "11111111-1111-4111-8111-111111111112",
  ssJohn: "11111111-1111-4111-8111-111111111113",
  living: "11111111-1111-4111-8111-111111111121",
  insurance: "11111111-1111-4111-8111-111111111122",
  mortgage: "11111111-1111-4111-8111-111111111131",
  rule401k: "11111111-1111-4111-8111-111111111141",
  child: "11111111-1111-4111-8111-111111111151",
  charity: "11111111-1111-4111-8111-111111111161",
  /** An id that belongs to no record in this household. */
  foreign: "99999999-9999-4999-8999-999999999999",
} as const;

const MAP: Record<string, string> = {
  "acct-401k": IDS.k401,
  "acct-roth": IDS.roth,
  "acct-brokerage": IDS.brokerage,
  "acct-savings": IDS.savings,
  "acct-home": IDS.home,
  "inc-salary-john": IDS.salaryJohn,
  "inc-salary-jane": IDS.salaryJane,
  "inc-ss-john": IDS.ssJohn,
  "exp-living": IDS.living,
  "exp-insurance": IDS.insurance,
  "liab-mortgage": IDS.mortgage,
  "sav-401k": IDS.rule401k,
};
const re = (id: string) => MAP[id] ?? id;

export function whatIfTree(): ClientData {
  const t = structuredClone(buildClientData());
  t.accounts = t.accounts.map((a) => ({ ...a, id: re(a.id) }));
  t.incomes = t.incomes.map((i) => ({
    ...i,
    id: re(i.id),
    // John's salary stops when he retires, so a retirement_age change moves
    // the projection (applyMutations reshifts ref-anchored years). Without
    // it, nothing here reads the retirement age and every age projects alike.
    ...(i.id === "inc-salary-john" ? { endYearRef: "client_retirement" } : {}),
  }));
  t.expenses = t.expenses.map((e) => ({ ...e, id: re(e.id) }));
  t.liabilities = t.liabilities.map((l) => ({
    ...l,
    id: re(l.id),
    ...(l.linkedPropertyId ? { linkedPropertyId: re(l.linkedPropertyId) } : {}),
  }));
  t.savingsRules = t.savingsRules.map((r) => ({ ...r, id: re(r.id), accountId: re(r.accountId) }));
  t.withdrawalStrategy = t.withdrawalStrategy.map((w) => ({ ...w, accountId: re(w.accountId) }));
  t.familyMembers = [
    ...(t.familyMembers ?? []),
    {
      id: IDS.child,
      role: "child",
      relationship: "child",
      firstName: "Ava",
      lastName: "Smith",
      dateOfBirth: "2005-03-01",
    },
  ];
  t.externalBeneficiaries = [{ id: IDS.charity, name: "Food Bank", kind: "charity", charityType: "public" }];
  // Resolve tied years the way the loader does, so a projection of this raw
  // tree and one through applyMutations([]) see the same salary years.
  return resolveRefYears(t);
}
