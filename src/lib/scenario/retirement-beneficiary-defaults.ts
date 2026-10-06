// src/lib/scenario/retirement-beneficiary-defaults.ts
//
// The scenario side of a retirement account's default beneficiaries (the base
// side is in the accounts write core). The changes route runs every scenario
// account write through here before storing it: an added retirement account
// starts on the household's defaults, and an untouched default follows a
// change of owner. People come from the scenario's effective tree, so a child
// the scenario added counts.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountOwners, scenarioChanges } from "@/db/schema";
import type { BeneficiaryRef } from "@/engine/types";
import {
  type DefaultDesignation,
  defaultRetirementBeneficiaries,
  isDefaultDesignationSet,
} from "@/lib/beneficiaries/default-retirement-beneficiaries";
import { priorToValues } from "./changes-writer";
import { loadEffectiveTree } from "./loader";

type Fields = Record<string, unknown>;

interface ScenarioScope {
  clientId: string;
  firmId: string;
  scenarioId: string;
}

function soleFamilyMemberOwner(owners: unknown): string | null {
  if (!Array.isArray(owners) || owners.length !== 1) return null;
  const o = owners[0] as { kind?: unknown; familyMemberId?: unknown };
  return o.kind === "family_member" && typeof o.familyMemberId === "string" ? o.familyMemberId : null;
}

function toRefs(defaults: DefaultDesignation[]): BeneficiaryRef[] {
  return defaults.map((d) => ({
    id: crypto.randomUUID(),
    tier: d.tier,
    percentage: d.percentage,
    householdRole: d.householdRole ?? undefined,
    familyMemberId: d.familyMemberId ?? undefined,
    sortOrder: d.sortOrder,
  }));
}

/** The account's sole owner as this scenario last saved it — the add row's,
 *  else an earlier edit's, else the base plan's. A few small reads, so every
 *  save can rule out "owner unchanged" before loading the whole tree. */
async function savedSoleOwner(scenarioId: string, accountId: string): Promise<string | null> {
  const rows = await db
    .select({ opType: scenarioChanges.opType, payload: scenarioChanges.payload })
    .from(scenarioChanges)
    .where(
      and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.targetKind, "account"),
        eq(scenarioChanges.targetId, accountId),
      ),
    );
  const add = rows.find((r) => r.opType === "add");
  if (add) return soleFamilyMemberOwner((add.payload as Fields).owners);
  const edit = rows.find((r) => r.opType === "edit");
  const editedOwners = edit ? priorToValues(edit.payload).owners : undefined;
  if (editedOwners !== undefined) return soleFamilyMemberOwner(editedOwners);
  const base = await db
    .select({ familyMemberId: accountOwners.familyMemberId })
    .from(accountOwners)
    .where(eq(accountOwners.accountId, accountId));
  return base.length === 1 ? base[0].familyMemberId : null;
}

async function scenarioTree({ clientId, firmId, scenarioId }: ScenarioScope) {
  return (await loadEffectiveTree(clientId, firmId, scenarioId, {})).effectiveTree;
}

/** An added retirement account that names no beneficiaries gets the defaults. */
export async function withDefaultBeneficiariesOnAdd(scope: ScenarioScope, entity: Fields): Promise<Fields> {
  const ownerId = soleFamilyMemberOwner(entity.owners);
  if (entity.category !== "retirement" || "beneficiaries" in entity || !ownerId) return entity;
  const tree = await scenarioTree(scope);
  const defaults = defaultRetirementBeneficiaries(ownerId, tree.familyMembers ?? []);
  return defaults.length > 0 ? { ...entity, beneficiaries: toRefs(defaults) } : entity;
}

/** A new owner re-points beneficiaries that are still the prior owner's default. */
export async function withDefaultBeneficiariesFollowingOwner(
  scope: ScenarioScope,
  accountId: string,
  desiredFields: Fields,
): Promise<Fields> {
  const newOwnerId = soleFamilyMemberOwner(desiredFields.owners);
  if (!newOwnerId || "beneficiaries" in desiredFields) return desiredFields;
  // Rule out another category and an unchanged owner before loading the tree.
  if (desiredFields.category !== undefined && desiredFields.category !== "retirement") return desiredFields;
  const priorOwnerId = await savedSoleOwner(scope.scenarioId, accountId);
  if (!priorOwnerId || priorOwnerId === newOwnerId) return desiredFields;
  const tree = await scenarioTree(scope);
  const account = tree.accounts.find((a) => a.id === accountId);
  if (!account || (desiredFields.category ?? account.category) !== "retirement") return desiredFields;
  const people = tree.familyMembers ?? [];
  if (!isDefaultDesignationSet(account.beneficiaries ?? [], defaultRetirementBeneficiaries(priorOwnerId, people))) {
    return desiredFields;
  }
  return { ...desiredFields, beneficiaries: toRefs(defaultRetirementBeneficiaries(newOwnerId, people)) };
}
