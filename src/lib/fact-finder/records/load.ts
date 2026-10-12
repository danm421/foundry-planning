// src/lib/fact-finder/records/load.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  disabilityPolicies,
  externalBeneficiaries,
  gifts,
  ltcPolicies,
  notesReceivable,
  savingsRules,
  scenarios,
  stockOptionGrants,
} from "@/db/schema";
import { loadCandidates, loadLivingSlots } from "@/lib/imports/match";
import type { ExistingRecords } from "./types";

/** The client's base-case scenario. No Clerk session needed — the caller has authorized the client. */
export async function resolveBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);
  return row?.id ?? null;
}

export async function loadExistingRecords(clientId: string, scenarioId: string): Promise<ExistingRecords> {
  const [candidates, livingSlots, external, disability, ltc, giftRows, savings, grants, notes] = await Promise.all([
    loadCandidates(clientId, scenarioId),
    loadLivingSlots(clientId, scenarioId),
    db
      .select({ id: externalBeneficiaries.id, name: externalBeneficiaries.name })
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, clientId)),
    db
      .select({ id: disabilityPolicies.id, name: disabilityPolicies.name, insured: disabilityPolicies.insured, carrier: disabilityPolicies.carrier })
      .from(disabilityPolicies)
      .where(eq(disabilityPolicies.clientId, clientId)),
    db
      .select({ id: ltcPolicies.id, name: ltcPolicies.name, insured: ltcPolicies.insured, carrier: ltcPolicies.carrier })
      .from(ltcPolicies)
      .where(eq(ltcPolicies.clientId, clientId)),
    db
      .select({ id: gifts.id, year: gifts.year, grantor: gifts.grantor, amount: gifts.amount })
      .from(gifts)
      .where(and(eq(gifts.clientId, clientId), isNull(gifts.parentGiftId))),
    db
      .select({ id: savingsRules.id, accountId: savingsRules.accountId, accountName: accounts.name })
      .from(savingsRules)
      .innerJoin(accounts, eq(accounts.id, savingsRules.accountId))
      .where(and(eq(savingsRules.clientId, clientId), eq(savingsRules.scenarioId, scenarioId))),
    db
      .select({
        id: stockOptionGrants.id,
        accountName: accounts.name,
        grantNumber: stockOptionGrants.grantNumber,
        grantDate: stockOptionGrants.grantDate,
        grantType: stockOptionGrants.grantType,
      })
      .from(stockOptionGrants)
      .innerJoin(accounts, eq(accounts.id, stockOptionGrants.accountId))
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenarioId))),
    db
      .select({ id: notesReceivable.id, name: notesReceivable.name, faceValue: notesReceivable.faceValue })
      .from(notesReceivable)
      .where(and(eq(notesReceivable.clientId, clientId), eq(notesReceivable.scenarioId, scenarioId))),
  ]);

  return {
    candidates: { ...candidates, livingSlots },
    externalBeneficiaries: external,
    disabilityPolicies: disability,
    ltcPolicies: ltc,
    gifts: giftRows.map((g) => ({ ...g, amount: g.amount === null ? null : Number(g.amount) })),
    savingsRules: savings,
    stockOptionGrants: grants.map((g) => ({ ...g, grantDate: String(g.grantDate) })),
    notesReceivable: notes.map((n) => ({ ...n, faceValue: Number(n.faceValue) })),
  };
}
