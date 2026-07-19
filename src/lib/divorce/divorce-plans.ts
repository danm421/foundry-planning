// Divorce-planning draft service. One LIVE draft (status = 'draft') per
// married client; the workbench (settings + per-object allocation decisions)
// never copies balances — it always joins live planning data via
// loadDivisibleObjects. Commit (Task 9+) is one-way and out of scope here.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  divorcePlans,
  divorcePlanAllocations,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  familyMembers,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  allocationKey,
  resolveAllocations,
  validateAllocation,
  AllocationError,
} from "./allocation-rules";
import { loadDivisibleObjects } from "./divisible-objects";
import { computeSideTotals, type SideTotals } from "./side-totals";
import type { DivorceDraftSettings, DivorceAllocationItem } from "./schemas";
import type { DivisibleObject, ResolvedAllocation, DivorceDisposition } from "./allocation-rules";

export class DivorcePlanError extends Error {
  code: "not_married" | "no_spouse_contact" | "already_committed" | "no_draft";
  constructor(code: DivorcePlanError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DivorcePlanError";
  }
}

type DivorcePlanRow = typeof divorcePlans.$inferSelect;

/** Load the single live (status='draft') plan row for a client, org-scoped. */
async function loadLiveDraft(clientId: string, firmId: string): Promise<DivorcePlanRow | null> {
  const [row] = await db
    .select()
    .from(divorcePlans)
    .where(
      and(
        eq(divorcePlans.clientId, clientId),
        eq(divorcePlans.firmId, firmId),
        eq(divorcePlans.status, "draft"),
      ),
    );
  return row ?? null;
}

export async function getOrCreateDraft(args: {
  clientId: string;
  firmId: string;
  userId: string;
}): Promise<DivorcePlanRow> {
  const { clientId, firmId, userId } = args;

  const [client] = await db
    .select({
      filingStatus: clients.filingStatus,
      crmHouseholdId: clients.crmHouseholdId,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) throw new Error("Client not found");

  if (client.filingStatus !== "married_joint" && client.filingStatus !== "married_separate") {
    throw new DivorcePlanError("not_married", "Client is not filing as married");
  }

  const [household] = await db
    .select({ state: crmHouseholds.state })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.id, client.crmHouseholdId));

  const [spouseContact] = await db
    .select({ id: crmHouseholdContacts.id })
    .from(crmHouseholdContacts)
    .where(
      and(
        eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
        eq(crmHouseholdContacts.role, "spouse"),
      ),
    );
  if (!spouseContact) {
    throw new DivorcePlanError("no_spouse_contact", "Household has no spouse contact");
  }

  // Race-safe create: insert and let the partial unique index
  // (divorce_plans_live_draft_uniq) absorb a concurrent create; then select
  // the live draft regardless of which caller's insert actually landed.
  const inserted = await db
    .insert(divorcePlans)
    .values({
      clientId,
      firmId,
      spouseState: household?.state ?? null,
      splitYear: new Date().getFullYear(),
      createdBy: userId,
    })
    .onConflictDoNothing({
      target: divorcePlans.clientId,
      where: sql`${divorcePlans.status} = 'draft'`,
    })
    .returning();

  const plan = inserted[0];
  if (plan) {
    await recordAudit({
      action: "divorce_plan.create",
      resourceType: "divorce_plan",
      resourceId: plan.id,
      clientId,
      firmId,
      actorId: userId,
    });
    return plan;
  }

  const existing = await loadLiveDraft(clientId, firmId);
  if (!existing) {
    throw new Error("Divorce draft insert conflicted but no live draft was found");
  }
  return existing;
}

export async function updateDraftSettings(args: {
  clientId: string;
  firmId: string;
  patch: DivorceDraftSettings;
}): Promise<void> {
  const { clientId, firmId, patch } = args;
  const draft = await loadLiveDraft(clientId, firmId);
  if (!draft) throw new DivorcePlanError("no_draft", "No live divorce draft for this client");

  const set: Partial<typeof divorcePlans.$inferInsert> = { updatedAt: new Date() };
  if (patch.primaryFilingStatus !== undefined) set.primaryFilingStatus = patch.primaryFilingStatus;
  if (patch.spouseFilingStatus !== undefined) set.spouseFilingStatus = patch.spouseFilingStatus;
  if (patch.spouseState !== undefined) set.spouseState = patch.spouseState;
  if (patch.splitYear !== undefined) set.splitYear = patch.splitYear;
  if (patch.beneficiaryCleanup !== undefined) set.beneficiaryCleanup = patch.beneficiaryCleanup;

  await db.update(divorcePlans).set(set).where(eq(divorcePlans.id, draft.id));

  await recordAudit({
    action: "divorce_plan.update",
    resourceType: "divorce_plan",
    resourceId: draft.id,
    clientId,
    firmId,
  });
}

export async function upsertAllocations(args: {
  clientId: string;
  firmId: string;
  items: DivorceAllocationItem[];
}): Promise<void> {
  const { clientId, firmId, items } = args;
  const draft = await loadLiveDraft(clientId, firmId);
  if (!draft) throw new DivorcePlanError("no_draft", "No live divorce draft for this client");

  const { objects } = await loadDivisibleObjects(clientId);
  const byKey = new Map(objects.map((o) => [allocationKey(o.kind, o.id), o]));

  for (const item of items) {
    const obj = byKey.get(allocationKey(item.targetKind, item.targetId));
    if (!obj) {
      throw new AllocationError(
        "not_allocatable",
        `${item.targetKind} ${item.targetId} is not a divisible object for this client`,
      );
    }
    validateAllocation(obj, item.disposition, item.splitPercentToSpouse);
  }

  await db
    .insert(divorcePlanAllocations)
    .values(
      items.map((item) => ({
        divorcePlanId: draft.id,
        targetKind: item.targetKind,
        targetId: item.targetId,
        disposition: item.disposition,
        splitPercentToSpouse:
          item.splitPercentToSpouse == null ? null : item.splitPercentToSpouse.toFixed(4),
      })),
    )
    .onConflictDoUpdate({
      target: [
        divorcePlanAllocations.divorcePlanId,
        divorcePlanAllocations.targetKind,
        divorcePlanAllocations.targetId,
      ],
      set: {
        disposition: sql`excluded.disposition`,
        splitPercentToSpouse: sql`excluded.split_percent_to_spouse`,
        updatedAt: sql`now()`,
      },
    });

  await recordAudit({
    action: "divorce_plan.update",
    resourceType: "divorce_plan",
    resourceId: draft.id,
    clientId,
    firmId,
    metadata: { allocationCount: items.length },
  });
}

export async function abandonDraft(args: {
  clientId: string;
  firmId: string;
  userId: string;
}): Promise<void> {
  const { clientId, firmId, userId } = args;
  const draft = await loadLiveDraft(clientId, firmId);
  if (!draft) throw new DivorcePlanError("no_draft", "No live divorce draft for this client");

  await db
    .update(divorcePlans)
    .set({ status: "abandoned", updatedAt: new Date() })
    .where(eq(divorcePlans.id, draft.id));

  await recordAudit({
    action: "divorce_plan.abandon",
    resourceType: "divorce_plan",
    resourceId: draft.id,
    clientId,
    firmId,
    actorId: userId,
  });
}

export interface WorkbenchPayload {
  plan: DivorcePlanRow;
  objects: DivisibleObject[];
  allocations: Array<{
    targetKind: string;
    targetId: string;
    disposition: DivorceDisposition;
    splitPercentToSpouse: string | null;
  }>;
  resolved: Array<[string, ResolvedAllocation]>; // serialized Map entries
  totals: { primary: SideTotals; spouse: SideTotals };
  people: { primaryName: string; spouseName: string };
}

export async function loadWorkbench(args: {
  clientId: string;
  firmId: string;
}): Promise<WorkbenchPayload> {
  const { clientId, firmId } = args;
  const plan = await loadLiveDraft(clientId, firmId);
  if (!plan) throw new DivorcePlanError("no_draft", "No live divorce draft for this client");

  const { objects, primaryFamilyMemberId, spouseFamilyMemberId } =
    await loadDivisibleObjects(clientId);

  const allocationRows = await db
    .select({
      targetKind: divorcePlanAllocations.targetKind,
      targetId: divorcePlanAllocations.targetId,
      disposition: divorcePlanAllocations.disposition,
      splitPercentToSpouse: divorcePlanAllocations.splitPercentToSpouse,
    })
    .from(divorcePlanAllocations)
    .where(eq(divorcePlanAllocations.divorcePlanId, plan.id));

  const resolved = resolveAllocations(objects, allocationRows);
  const totals = computeSideTotals(objects, resolved);

  const fmIds = [primaryFamilyMemberId, spouseFamilyMemberId].filter(
    (id): id is string => !!id,
  );
  const fmRows = fmIds.length
    ? await db
        .select({
          id: familyMembers.id,
          firstName: familyMembers.firstName,
          lastName: familyMembers.lastName,
        })
        .from(familyMembers)
        .where(inArray(familyMembers.id, fmIds))
    : [];
  const nameById = new Map(
    fmRows.map((fm) => [fm.id, `${fm.firstName} ${fm.lastName ?? ""}`.trim()]),
  );

  return {
    plan,
    objects,
    allocations: allocationRows,
    resolved: [...resolved.entries()],
    totals,
    people: {
      primaryName: nameById.get(primaryFamilyMemberId) ?? "",
      spouseName: (spouseFamilyMemberId && nameById.get(spouseFamilyMemberId)) || "",
    },
  };
}
