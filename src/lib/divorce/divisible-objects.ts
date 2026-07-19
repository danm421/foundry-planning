// Base-scenario divisible-objects loader for the divorce workbench.
//
// Reads a client's Base Case and flattens every allocatable thing — accounts,
// incomes, expenses, liabilities, notes receivable, entities, and non-principal
// family members — into a single `DivisibleObject[]`, resolving each to a side
// (primary / spouse / joint / entity / external / none) per the Rulebook in
// allocation-rules.ts. Read-only; authz + org-scoping happen at the route layer.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarios,
  accounts,
  accountOwners,
  incomes,
  expenses,
  liabilities,
  liabilityOwners,
  notesReceivable,
  noteReceivableOwners,
  entities,
  entityOwners,
  familyMembers,
} from "@/db/schema";
import type { DivisibleObject, OwnerSide } from "./allocation-rules";

export interface LoadDivisibleObjectsResult {
  objects: DivisibleObject[];
  baseScenarioId: string;
  primaryFamilyMemberId: string;
  spouseFamilyMemberId: string | null;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export async function loadDivisibleObjects(
  clientId: string,
): Promise<LoadDivisibleObjectsResult> {
  // 1. Base scenario id.
  const [base] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);
  if (!base) {
    throw new Error(`No base-case scenario found for client ${clientId}`);
  }
  const baseScenarioId = base.id;

  // 2a. Parent rows in parallel. Accounts/incomes/expenses/liabilities/notes are
  // scenario-scoped; entities and family_members are client-scoped.
  const [
    accountRows,
    incomeRows,
    expenseRows,
    liabilityRows,
    noteRows,
    entityRows,
    fmRows,
  ] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, baseScenarioId))),
    db
      .select()
      .from(incomes)
      .where(and(eq(incomes.clientId, clientId), eq(incomes.scenarioId, baseScenarioId))),
    db
      .select()
      .from(expenses)
      .where(and(eq(expenses.clientId, clientId), eq(expenses.scenarioId, baseScenarioId))),
    db
      .select()
      .from(liabilities)
      .where(
        and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, baseScenarioId)),
      ),
    db
      .select()
      .from(notesReceivable)
      .where(
        and(
          eq(notesReceivable.clientId, clientId),
          eq(notesReceivable.scenarioId, baseScenarioId),
        ),
      ),
    db.select().from(entities).where(eq(entities.clientId, clientId)),
    db.select().from(familyMembers).where(eq(familyMembers.clientId, clientId)),
  ]);

  // 2b. Owner join rows in parallel, keyed off the parent ids we just loaded.
  const accountIds = accountRows.map((a) => a.id);
  const entityIds = entityRows.map((e) => e.id);
  const liabilityIds = liabilityRows.map((l) => l.id);
  const noteIds = noteRows.map((n) => n.id);

  const [acctOwnerRows, entOwnerRows, liabOwnerRows, noteOwnerRows] = await Promise.all([
    accountIds.length
      ? db.select().from(accountOwners).where(inArray(accountOwners.accountId, accountIds))
      : Promise.resolve([]),
    entityIds.length
      ? db.select().from(entityOwners).where(inArray(entityOwners.entityId, entityIds))
      : Promise.resolve([]),
    liabilityIds.length
      ? db
          .select()
          .from(liabilityOwners)
          .where(inArray(liabilityOwners.liabilityId, liabilityIds))
      : Promise.resolve([]),
    noteIds.length
      ? db
          .select()
          .from(noteReceivableOwners)
          .where(inArray(noteReceivableOwners.noteReceivableId, noteIds))
      : Promise.resolve([]),
  ]);

  // 3. Side map from family_members.role: client→primary, spouse→spouse. Only
  // the two principals map; everyone else (children, dependents) is unmapped.
  const familyMemberSide = new Map<string, "primary" | "spouse">();
  for (const fm of fmRows) {
    if (fm.role === "client") familyMemberSide.set(fm.id, "primary");
    else if (fm.role === "spouse") familyMemberSide.set(fm.id, "spouse");
  }
  const primaryFamilyMemberId = fmRows.find((fm) => fm.role === "client")?.id ?? "";
  const spouseFamilyMemberId = fmRows.find((fm) => fm.role === "spouse")?.id ?? null;

  // Resolve a side from a bag of family_member owner rows: all mapped rows one
  // side → that side; rows spanning both → joint; no mapped rows → none.
  const sideFromFmRows = (fmIds: (string | null)[]): OwnerSide => {
    const sides = new Set<"primary" | "spouse">();
    for (const id of fmIds) {
      if (!id) continue;
      const s = familyMemberSide.get(id);
      if (s) sides.add(s);
    }
    if (sides.size === 0) return "none";
    if (sides.size === 1) return [...sides][0];
    return "joint";
  };

  const ownersByAccount = groupBy(acctOwnerRows, (r) => r.accountId);
  const ownersByEntity = groupBy(entOwnerRows, (r) => r.entityId);
  const ownersByLiability = groupBy(liabOwnerRows, (r) => r.liabilityId);
  const ownersByNote = groupBy(noteOwnerRows, (r) => r.noteReceivableId);
  const accountById = new Map(accountRows.map((a) => [a.id, a]));

  const objects: DivisibleObject[] = [];
  // entity id → owned account ids (built while walking accounts).
  const entityChildIds = new Map<string, string[]>();

  // ── Accounts ──
  for (const a of accountRows) {
    const owners = ownersByAccount.get(a.id) ?? [];
    let ownerSide: OwnerSide;
    let entityOwnedById: string | null = null;

    if (a.category === "education_savings") {
      // 529s carry no owner rows; side follows the grantor family member.
      const grantorSide = a.grantorFamilyMemberId
        ? familyMemberSide.get(a.grantorFamilyMemberId)
        : undefined;
      ownerSide = grantorSide ?? "none";
    } else if (owners.length === 0) {
      ownerSide = "none";
    } else {
      const entityRow = owners.find((o) => o.entityId);
      const externalRow = owners.find((o) => o.externalBeneficiaryId);
      if (entityRow) {
        entityOwnedById = entityRow.entityId!;
        ownerSide = "entity";
        const list = entityChildIds.get(entityOwnedById) ?? [];
        list.push(a.id);
        entityChildIds.set(entityOwnedById, list);
      } else if (externalRow) {
        ownerSide = "external";
      } else {
        ownerSide = sideFromFmRows(owners.map((o) => o.familyMemberId));
      }
    }

    objects.push({
      kind: "account",
      id: a.id,
      label: a.name,
      subtype: a.category,
      value: Number(a.value),
      basis: Number(a.basis),
      rothValue: Number(a.rothValue),
      annualAmount: 0,
      ownerSide,
      entityOwnedById,
      childIds: [],
    });
  }

  // ── Entities ──. value = entities.value + Σ owned-account values; children
  // are folded in so side totals count them once (inside the entity).
  for (const e of entityRows) {
    const owners = ownersByEntity.get(e.id) ?? [];
    const fmSide = sideFromFmRows(owners.map((o) => o.familyMemberId));
    const ownerSide: OwnerSide =
      fmSide === "primary" || fmSide === "spouse" ? fmSide : "joint";
    const childIds = entityChildIds.get(e.id) ?? [];

    let value = Number(e.value);
    let basis = Number(e.basis);
    let rothValue = 0;
    for (const childId of childIds) {
      const child = accountById.get(childId);
      if (child) {
        value += Number(child.value);
        basis += Number(child.basis);
        rothValue += Number(child.rothValue);
      }
    }

    const subtype =
      e.entityType === "trust" ? e.trustSubType ?? "trust" : e.entityType;

    objects.push({
      kind: "entity",
      id: e.id,
      label: e.name,
      subtype,
      value,
      basis,
      rothValue,
      annualAmount: 0,
      ownerSide,
      entityOwnedById: null,
      childIds,
    });
  }

  // ── Incomes ──. ownerEntityId / ownerAccountId / linkedPropertyId all mean
  // "follows its container" — stamp entityOwnedById with that id and drop it
  // from independent allocation; otherwise map the owner enum to a side.
  for (const inc of incomeRows) {
    let ownerSide: OwnerSide;
    let entityOwnedById: string | null = null;
    if (inc.ownerEntityId) {
      entityOwnedById = inc.ownerEntityId;
      ownerSide = "entity";
    } else if (inc.ownerAccountId) {
      entityOwnedById = inc.ownerAccountId;
      ownerSide = "entity";
    } else if (inc.linkedPropertyId) {
      entityOwnedById = inc.linkedPropertyId;
      ownerSide = "entity";
    } else {
      ownerSide =
        inc.owner === "client" ? "primary" : inc.owner === "spouse" ? "spouse" : "joint";
    }

    objects.push({
      kind: "income",
      id: inc.id,
      label: inc.name,
      subtype: inc.type,
      value: 0,
      basis: 0,
      rothValue: 0,
      annualAmount: Number(inc.annualAmount),
      ownerSide,
      entityOwnedById,
      childIds: [],
    });
  }

  // ── Expenses ──. Container-owned expenses follow their entity/account; the
  // rest carry no side (they belong to the household, split by the advisor).
  for (const ex of expenseRows) {
    let ownerSide: OwnerSide = "none";
    let entityOwnedById: string | null = null;
    if (ex.ownerEntityId) {
      entityOwnedById = ex.ownerEntityId;
      ownerSide = "entity";
    } else if (ex.ownerAccountId) {
      entityOwnedById = ex.ownerAccountId;
      ownerSide = "entity";
    }

    objects.push({
      kind: "expense",
      id: ex.id,
      label: ex.name,
      subtype: ex.type,
      value: 0,
      basis: 0,
      rothValue: 0,
      annualAmount: Number(ex.annualAmount),
      ownerSide,
      entityOwnedById,
      childIds: [],
    });
  }

  // ── Liabilities ──. Side via liability_owners (entity row → entity-owned;
  // otherwise family-member sides). Value is the positive balance.
  for (const l of liabilityRows) {
    const owners = ownersByLiability.get(l.id) ?? [];
    let ownerSide: OwnerSide;
    let entityOwnedById: string | null = null;
    const entityRow = owners.find((o) => o.entityId);
    if (entityRow) {
      entityOwnedById = entityRow.entityId!;
      ownerSide = "entity";
    } else if (owners.length === 0) {
      ownerSide = "none";
    } else {
      ownerSide = sideFromFmRows(owners.map((o) => o.familyMemberId));
    }

    objects.push({
      kind: "liability",
      id: l.id,
      label: l.name,
      subtype: l.liabilityType ?? null,
      value: Number(l.balance),
      basis: 0,
      rothValue: 0,
      annualAmount: 0,
      ownerSide,
      entityOwnedById,
      childIds: [],
    });
  }

  // ── Notes receivable ──. Side via note_receivable_owners (entity / external /
  // family-member). Value is the as-of balance, falling back to face value.
  for (const n of noteRows) {
    const owners = ownersByNote.get(n.id) ?? [];
    let ownerSide: OwnerSide;
    let entityOwnedById: string | null = null;
    const entityRow = owners.find((o) => o.entityId);
    const externalRow = owners.find((o) => o.externalBeneficiaryId);
    if (entityRow) {
      entityOwnedById = entityRow.entityId!;
      ownerSide = "entity";
    } else if (externalRow) {
      ownerSide = "external";
    } else if (owners.length === 0) {
      ownerSide = "none";
    } else {
      ownerSide = sideFromFmRows(owners.map((o) => o.familyMemberId));
    }

    objects.push({
      kind: "note_receivable",
      id: n.id,
      label: n.name,
      subtype: null,
      value: Number(n.asOfBalance ?? n.faceValue),
      basis: Number(n.basis),
      rothValue: 0,
      annualAmount: 0,
      ownerSide,
      entityOwnedById,
      childIds: [],
    });
  }

  // ── Family members ──. The two principals define the sides and are never
  // divisible; every other member (child, dependent) is a duplicate-by-default
  // family_member object.
  for (const fm of fmRows) {
    if (fm.role === "client" || fm.role === "spouse") continue;
    objects.push({
      kind: "family_member",
      id: fm.id,
      label: `${fm.firstName} ${fm.lastName ?? ""}`,
      subtype: fm.relationship,
      value: 0,
      basis: 0,
      rothValue: 0,
      annualAmount: 0,
      ownerSide: "none",
      entityOwnedById: null,
      childIds: [],
    });
  }

  return { objects, baseScenarioId, primaryFamilyMemberId, spouseFamilyMemberId };
}
