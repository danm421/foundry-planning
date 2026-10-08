// Server-side: the loans the presentations builder's "Loan Amortization" page
// can print — the base plan's liabilities that have a schedule to draw.
import { db } from "@/db";
import { liabilities, scenarios } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import {
  byBalanceDesc,
  hasAmortizationSchedule,
} from "@/lib/presentations/pages/liability-amortization/view-model";

export interface LiabilityPickerOption {
  id: string;
  name: string;
  balance: number;
}

export async function loadLiabilityPickerOptions(clientId: string): Promise<LiabilityPickerOption[]> {
  const rows = await db
    .select({
      id: liabilities.id,
      name: liabilities.name,
      balance: liabilities.balance,
      monthlyPayment: liabilities.monthlyPayment,
      termMonths: liabilities.termMonths,
      liabilityType: liabilities.liabilityType,
    })
    .from(liabilities)
    .innerJoin(scenarios, eq(scenarios.id, liabilities.scenarioId))
    .where(and(eq(liabilities.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .orderBy(asc(liabilities.createdAt));

  return rows
    .map((r) => ({
      ...r,
      balance: parseFloat(r.balance),
      monthlyPayment: r.monthlyPayment != null ? parseFloat(r.monthlyPayment) : 0,
    }))
    .filter(hasAmortizationSchedule)
    .sort(byBalanceDesc)
    .map(({ id, name, balance }) => ({ id, name, balance }));
}
