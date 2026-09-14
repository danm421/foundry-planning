// src/lib/scenario/load-scenario-options.ts
//
// Scenario list for a compare picker. Ordered base-case-first then
// alphabetical, matching the chip row in clients/[id]/layout.tsx so a
// scenario keeps the same position everywhere it is listed.
//
// Callers must already have established firm scope (the estate pages do so via
// requireOrgId + a scoped client lookup before calling this).
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios as scenariosTable } from "@/db/schema";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

export async function loadScenarioOptions(
  clientId: string,
): Promise<ScenarioOption[]> {
  return db
    .select({
      id: scenariosTable.id,
      name: scenariosTable.name,
      isBaseCase: scenariosTable.isBaseCase,
    })
    .from(scenariosTable)
    .where(eq(scenariosTable.clientId, clientId))
    .orderBy(desc(scenariosTable.isBaseCase), asc(scenariosTable.name));
}
