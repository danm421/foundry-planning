// src/lib/portal/load-organizer-map.ts
//
// Server loader for the Organizer's Goals and Cash Flow tabs. One loader, not
// two: both boards need the same effective tree, the same ColumnContext and the
// same `people`, so splitting it would write the derivation twice and let the
// two tabs disagree.
//
// The tree is resolved with the literal "base" — the portal has no scenario
// concept and must never render one. `buildMapBoards` is the SAME builder the
// advisor Household Map calls, which is what keeps a card meaning the same
// thing on both surfaces.
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, entities, familyMembers, scenarios } from "@/db/schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { buildMapBoards } from "@/lib/household-map/build-boards";
import type { MapItem, MapPerson } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";

export interface OrganizerMapData {
  people: { client: MapPerson; spouse: MapPerson | null; children: MapPerson[] };
  items: MapItem[];
  goals: MapGoal[];
  canEdit: boolean;
}

/**
 * Null when the household cannot produce a board at all — no base-case scenario,
 * or no primary CRM contact date of birth. Both are real states for a
 * half-onboarded client, and an empty board would read as "you have no goals"
 * rather than "your advisor hasn't finished setting this up".
 */
export async function loadOrganizerMap(clientId: string): Promise<OrganizerMapData | null> {
  const [client] = await db
    .select({
      firmId: clients.firmId,
      crmHouseholdId: clients.crmHouseholdId,
      lifeExpectancy: clients.lifeExpectancy,
      portalEditEnabled: clients.portalEditEnabled,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const [[scenario], contactRows, familyMemberRows, entityRows] = await Promise.all([
    db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1),
    db
      .select({
        role: crmHouseholdContacts.role,
        dateOfBirth: crmHouseholdContacts.dateOfBirth,
      })
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId)),
    db
      .select({
        id: familyMembers.id,
        role: familyMembers.role,
        firstName: familyMembers.firstName,
        dateOfBirth: familyMembers.dateOfBirth,
      })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, clientId))
      .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
    db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.clientId, clientId))
      .orderBy(asc(entities.name)),
  ]);
  if (!scenario) return null;

  // CRM contacts are the sole source of DOB for milestone math, exactly as in
  // the advisor Map. No primary DOB means no derivable life-expectancy
  // milestone and no ages on the person nodes.
  const primaryDob = contactRows.find((c) => c.role === "primary")?.dateOfBirth ?? null;
  if (!primaryDob) return null;
  const spouseDob = contactRows.find((c) => c.role === "spouse")?.dateOfBirth ?? null;

  const { effectiveTree } = await loadEffectiveTree(clientId, client.firmId, "base", {});

  const { people, items, goals } = buildMapBoards({
    effectiveTree,
    identity: {
      dateOfBirth: primaryDob,
      spouseDob,
      lifeExpectancy: client.lifeExpectancy,
    },
    familyMemberRows,
    entityRows,
    today: new Date(),
  });

  return { people, items, goals, canEdit: client.portalEditEnabled };
}
