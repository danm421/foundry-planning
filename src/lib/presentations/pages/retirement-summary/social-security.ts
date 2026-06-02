// src/lib/presentations/pages/retirement-summary/social-security.ts
//
// Per-client Social Security ladder for the Retirement Summary report. Amounts
// are today's-dollar PIA-based monthly benefits (no COLA compounding across the
// ladder — COLA is shown separately as the assumption). See spec.
import type { ClientData, ClientInfo, Income } from "@/engine/types";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";

export interface SsLadderRow { age: number; monthly: number; selected: boolean; }

export interface SsClient {
  name: string;
  piaMonthly: number;
  claimAge: number;        // selected claim age in whole years (display)
  colaPct: number;
  alreadyClaiming: boolean;
  receivedMonthly: number | null; // set only when alreadyClaiming
  ladder: SsLadderRow[];           // empty when alreadyClaiming
}

export interface SsBreakdown { client: SsClient | null; spouse: SsClient | null; }

/** Display names for the client/spouse columns. `ClientData` does not carry
 *  assembled names, so the view-model passes them from BuildDataContext. */
export interface SsNames { client: string; spouse: string; }

const DEFAULT_NAMES: SsNames = { client: "Client", spouse: "Spouse" };

function birthYear(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = Number(dob.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function buildOne(
  income: Income | undefined,
  dob: string | null | undefined,
  name: string,
  client: ClientInfo,
  nowYear: number,
): SsClient | null {
  if (!income || !dob) return null;
  const pia = income.piaMonthly ?? 0;
  if (pia <= 0) return null;

  const selectedMonths = resolveClaimAgeMonths(income, client) ?? (income.claimingAge ?? 67) * 12;
  const selectedAge = Math.round(selectedMonths / 12);
  const colaPct = income.growthRate ?? 0;

  const by = birthYear(dob);
  const currentAge = by == null ? 62 : nowYear - by;
  const alreadyClaiming = currentAge * 12 >= selectedMonths;

  if (alreadyClaiming) {
    return {
      name, piaMonthly: pia, claimAge: selectedAge, colaPct,
      alreadyClaiming: true,
      receivedMonthly: computeOwnMonthlyBenefit({ piaMonthly: pia, claimAgeMonths: selectedMonths, dob }),
      ladder: [],
    };
  }

  const startAge = Math.min(70, Math.max(62, Math.ceil(currentAge)));
  const ladder: SsLadderRow[] = [];
  for (let age = startAge; age <= 70; age++) {
    const monthly = computeOwnMonthlyBenefit({ piaMonthly: pia, claimAgeMonths: age * 12, dob });
    // Selected row = the year band containing the selected claim months.
    const selected = age * 12 <= selectedMonths && selectedMonths < (age + 1) * 12;
    ladder.push({ age, monthly, selected });
  }
  // If the selected age fell outside the rendered band (e.g. partial-month FRA
  // rounding pushed it past 70), flag the closest age so a row is always marked.
  if (!ladder.some((r) => r.selected) && ladder.length) {
    const target = Math.min(70, Math.max(startAge, selectedAge));
    const hit = ladder.find((r) => r.age === target) ?? ladder[ladder.length - 1];
    hit.selected = true;
  }

  return { name, piaMonthly: pia, claimAge: selectedAge, colaPct, alreadyClaiming: false, receivedMonthly: null, ladder };
}

export function buildSocialSecurity(
  clientData: ClientData,
  nowYear: number,
  names: SsNames = DEFAULT_NAMES,
): SsBreakdown {
  const client = clientData.client;
  const incomes = clientData.incomes.filter((i) => i.type === "social_security");
  const clientSs = incomes.find((i) => i.owner === "client" || i.owner === "joint");
  const spouseSs = incomes.find((i) => i.owner === "spouse");

  return {
    client: buildOne(clientSs, client.dateOfBirth, names.client, client, nowYear),
    spouse: buildOne(spouseSs, client.spouseDob, names.spouse, client, nowYear),
  };
}
