import { db } from "@/db";
import { taxYearParameters, familyMembers } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { dbRowToTaxYearParameters } from "@/lib/tax/dbMapper";
import { createTaxResolver, type TaxResolver } from "@/lib/tax/resolver";

// Analysis is a point-in-time read of a filed return; these only matter for
// inflating IRMAA tiers to taxYear+2 when that year isn't seeded yet.
const TAX_INFLATION_RATE = 0.025;
const SS_WAGE_GROWTH_RATE = 0.03;

function ageAtYearEnd(dob: string | null, taxYear: number): number | null {
  if (!dob) return null;
  const birthYear = Number(dob.slice(0, 4));
  return Number.isFinite(birthYear) ? taxYear - birthYear : null;
}

export async function loadAnalysisContext(
  clientId: string,
  taxYear: number,
): Promise<{ resolver: TaxResolver; primaryAge: number | null; spouseAge: number | null }> {
  const [paramRows, people] = await Promise.all([
    db.select().from(taxYearParameters),
    db
      .select({ role: familyMembers.role, dateOfBirth: familyMembers.dateOfBirth })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.role, ["client", "spouse"]))),
  ]);
  if (paramRows.length === 0) {
    throw new Error("No tax_year_parameters seeded — run `npm run seed:tax-data`.");
  }
  const resolver = createTaxResolver(paramRows.map(dbRowToTaxYearParameters), {
    taxInflationRate: TAX_INFLATION_RATE,
    ssWageGrowthRate: SS_WAGE_GROWTH_RATE,
  });
  const primary = people.find((p) => p.role === "client");
  const spouse = people.find((p) => p.role === "spouse");
  return {
    resolver,
    primaryAge: ageAtYearEnd(primary?.dateOfBirth ?? null, taxYear),
    spouseAge: ageAtYearEnd(spouse?.dateOfBirth ?? null, taxYear),
  };
}
