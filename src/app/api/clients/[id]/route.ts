import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  planSettings,
  familyMembers,
  accountOwners,
  liabilityOwners,
  entityOwners,
  beneficiaryDesignations,
  gifts,
  trustSplitInterestDetails,
} from "@/db/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { recordUpdate, recordDelete } from "@/lib/audit";
import { toClientSnapshot, CLIENT_FIELD_LABELS } from "@/lib/audit/snapshots/client";

export const dynamic = "force-dynamic";

// GET /api/clients/[id] — get single client
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id] — update client
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const body = await request.json();

    const [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // If the body removes the spouse (spouseName cleared), pre-check that no
    // rows still reference the spouse family_member. Account/liability owner
    // triggers would otherwise abort the cascade with cryptic errors, and the
    // CLUT/CLAT measuring-life FK is RESTRICT. Block here with a clear 409
    // before mutating clients so we don't end up half-updated.
    const spouseBeingRemoved =
      "spouseName" in body &&
      (body.spouseName == null || body.spouseName === "") &&
      existing.spouseName != null &&
      existing.spouseName !== "";
    if (spouseBeingRemoved) {
      const [spouseFm] = await db
        .select({ id: familyMembers.id })
        .from(familyMembers)
        .where(and(eq(familyMembers.clientId, id), eq(familyMembers.role, "spouse")));
      if (spouseFm) {
        const blockers = await collectSpouseDependents(spouseFm.id);
        if (blockers.length > 0) {
          return NextResponse.json(
            {
              error: `Cannot remove spouse: still referenced by ${blockers.join(", ")}. Reassign or delete those first.`,
            },
            { status: 409 },
          );
        }
      }
    }

    // Re-derive planEndAge whenever any input to the horizon calc changes.
    const updateBody = { ...body };
    const dobChanged = "dateOfBirth" in body;
    const leChanged = "lifeExpectancy" in body;
    const spouseDobChanged = "spouseDob" in body;
    const spouseLeChanged = "spouseLifeExpectancy" in body;
    if (dobChanged || leChanged || spouseDobChanged || spouseLeChanged) {
      updateBody.planEndAge = computePlanEndAge({
        clientDob: body.dateOfBirth ?? existing.dateOfBirth,
        clientLifeExpectancy: Number(body.lifeExpectancy ?? existing.lifeExpectancy),
        spouseDob:
          spouseDobChanged ? body.spouseDob ?? null : existing.spouseDob ?? null,
        spouseLifeExpectancy:
          spouseLeChanged
            ? body.spouseLifeExpectancy != null
              ? Number(body.spouseLifeExpectancy)
              : null
            : existing.spouseLifeExpectancy ?? null,
      });
    }

    // Explicit allowlist of mutable columns. New columns must be added
    // here to be settable via PUT — default-deny so a future sensitive
    // column doesn't silently become user-writable if we forget to add
    // it to a strip list. Schema identity fields (id/firmId/advisorId/
    // createdAt) and server-managed timestamps (updatedAt) are absent
    // by construction.
    const MUTABLE_CLIENT_FIELDS = [
      "firstName",
      "lastName",
      "dateOfBirth",
      "retirementAge",
      "planEndAge",
      "lifeExpectancy",
      "spouseName",
      "spouseLastName",
      "spouseDob",
      "spouseRetirementAge",
      "spouseLifeExpectancy",
      "filingStatus",
      "email",
      "address",
      "spouseEmail",
      "spouseAddress",
    ] as const;

    const safeUpdate: Record<string, unknown> = {};
    const incoming = updateBody as Record<string, unknown>;
    for (const key of MUTABLE_CLIENT_FIELDS) {
      if (key in incoming) safeUpdate[key] = incoming[key];
    }

    const [updated] = await db
      .update(clients)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)))
      .returning();

    // If the horizon moved, push the new planEndYear through to all the
    // client's scenarios so the engine and UI stay in sync without the
    // advisor having to re-save plan settings.
    if (updateBody.planEndAge != null) {
      const newEndYear =
        new Date(updated.dateOfBirth).getFullYear() + updateBody.planEndAge;
      await db
        .update(planSettings)
        .set({ planEndYear: newEndYear, updatedAt: new Date() })
        .where(eq(planSettings.clientId, id));
    }

    await syncHouseholdFamilyMembers(id, updated);

    await recordUpdate({
      action: "client.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      before: toClientSnapshot(existing),
      after: toClientSnapshot(updated),
      fieldLabels: CLIENT_FIELD_LABELS,
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id] — delete client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snapshot = toClientSnapshot(existing);

    await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    await recordDelete({
      action: "client.delete",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      snapshot,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Returns a list of human-readable references that block deleting the spouse
// family_member. account_owners / liability_owners / entity_owners would
// trigger sum-violation aborts on cascade; trust_split_interest_details
// measuring lives are RESTRICT FKs; beneficiary_designations and gifts cascade
// cleanly but we surface them so removal isn't silent data loss.
async function collectSpouseDependents(spouseFmId: string): Promise<string[]> {
  const [accs, liabs, ents, mlife, beneRefs, giftRefs] = await Promise.all([
    db.select({ id: accountOwners.accountId }).from(accountOwners).where(eq(accountOwners.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: liabilityOwners.liabilityId }).from(liabilityOwners).where(eq(liabilityOwners.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: entityOwners.entityId }).from(entityOwners).where(eq(entityOwners.familyMemberId, spouseFmId)).limit(1),
    db
      .select({ id: trustSplitInterestDetails.entityId })
      .from(trustSplitInterestDetails)
      .where(or(eq(trustSplitInterestDetails.measuringLife1Id, spouseFmId), eq(trustSplitInterestDetails.measuringLife2Id, spouseFmId)))
      .limit(1),
    db.select({ id: beneficiaryDesignations.id }).from(beneficiaryDesignations).where(eq(beneficiaryDesignations.familyMemberId, spouseFmId)).limit(1),
    db.select({ id: gifts.id }).from(gifts).where(eq(gifts.recipientFamilyMemberId, spouseFmId)).limit(1),
  ]);
  const out: string[] = [];
  if (accs.length) out.push("accounts");
  if (liabs.length) out.push("liabilities");
  if (ents.length) out.push("business ownership");
  if (mlife.length) out.push("trust measuring lives");
  if (beneRefs.length) out.push("beneficiary designations");
  if (giftRefs.length) out.push("gifts");
  return out;
}

// Reconciles role='client' / role='spouse' family_members rows with the
// post-update client row. Insert/update/delete as needed. Caller is expected
// to have already pre-checked that any spouse removal is dependent-free.
async function syncHouseholdFamilyMembers(
  clientId: string,
  c: typeof clients.$inferSelect,
): Promise<void> {
  const rows = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.clientId, clientId), inArray(familyMembers.role, ["client", "spouse"])));
  const clientRow = rows.find((r) => r.role === "client");
  const spouseRow = rows.find((r) => r.role === "spouse");

  if (clientRow) {
    await db
      .update(familyMembers)
      .set({
        firstName: c.firstName,
        lastName: c.lastName,
        dateOfBirth: c.dateOfBirth,
        updatedAt: new Date(),
      })
      .where(eq(familyMembers.id, clientRow.id));
  } else {
    await db.insert(familyMembers).values({
      clientId,
      role: "client",
      relationship: "other",
      firstName: c.firstName,
      lastName: c.lastName,
      dateOfBirth: c.dateOfBirth,
    });
  }

  if (c.spouseName) {
    const spouseFields = {
      firstName: c.spouseName,
      lastName: c.spouseLastName ?? c.lastName,
      dateOfBirth: c.spouseDob ?? null,
    };
    if (spouseRow) {
      await db
        .update(familyMembers)
        .set({ ...spouseFields, updatedAt: new Date() })
        .where(eq(familyMembers.id, spouseRow.id));
    } else {
      await db.insert(familyMembers).values({
        clientId,
        role: "spouse",
        relationship: "other",
        ...spouseFields,
      });
    }
  } else if (spouseRow) {
    await db.delete(familyMembers).where(eq(familyMembers.id, spouseRow.id));
  }
}
