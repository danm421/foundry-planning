import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, accountOwners, clients, familyMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordCreate, recordDelete } from "@/lib/audit";
import { toAccountSnapshot } from "@/lib/audit/snapshots/account";
import { parseBody } from "@/lib/schemas/common";
import { accountSplitSchema } from "@/lib/schemas/account-split";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [target] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Determine joint ownership via account_owners junction table.
    const ownerRows = await db
      .select({ familyMemberId: accountOwners.familyMemberId, entityId: accountOwners.entityId })
      .from(accountOwners)
      .where(eq(accountOwners.accountId, accountId));
    const fmOwnerRows = ownerRows.filter((r) => r.familyMemberId != null);
    const isJoint = fmOwnerRows.length >= 2;
    if (!isJoint) {
      return NextResponse.json(
        { error: "Only joint (household) accounts can be split" },
        { status: 400 },
      );
    }

    // Look up household principal FM ids (client and spouse).
    const fmRows = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(and(eq(familyMembers.clientId, id)));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;
    if (!clientFmId || !spouseFmId) {
      return NextResponse.json(
        { error: "Client and spouse family members must both exist to split a joint account" },
        { status: 400 },
      );
    }

    if (target.isDefaultChecking) {
      return NextResponse.json(
        { error: "The default household cash account cannot be split" },
        { status: 400 },
      );
    }

    // Splitting a life-insurance account would destroy the policy row via FK cascade.
    // Joint life-insurance is rare and not modeled; reject explicitly.
    if (target.category === "life_insurance") {
      return NextResponse.json(
        { error: "Life insurance accounts cannot be split — the policy is tied to the original account." },
        { status: 400 },
      );
    }

    const parsed = await parseBody(accountSplitSchema, request);
    if (!parsed.ok) return parsed.response;
    const { clientShare } = parsed.data;

    const value = parseFloat(target.value);
    const basis = parseFloat(target.basis);
    const rothValue = parseFloat(target.rothValue ?? "0");
    // Round client share first, then derive spouse via subtraction so that
    // clientValueRounded + spouseValueRounded always equals the original value
    // to the penny. Symmetric multiplication + independent toFixed() can drift ±$0.01.
    const clientValueRounded = +(value * clientShare).toFixed(2);
    const spouseValueRounded = +(value - clientValueRounded).toFixed(2);
    const clientBasisRounded = +(basis * clientShare).toFixed(2);
    const spouseBasisRounded = +(basis - clientBasisRounded).toFixed(2);
    const clientRothValueRounded = +(rothValue * clientShare).toFixed(2);
    const spouseRothValueRounded = +(rothValue - clientRothValueRounded).toFixed(2);

    const snapshot = await toAccountSnapshot(target);

    const result = await db.transaction(async (tx) => {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...targetRest } = target;
      void _id; void _ca; void _ua;

      const [clientAcct] = await tx
        .insert(accounts)
        .values({
          ...targetRest,
          value: clientValueRounded.toFixed(2),
          basis: clientBasisRounded.toFixed(2),
          rothValue: clientRothValueRounded.toFixed(2),
          name: `${target.name} (${client.firstName ?? "Client"} share)`,
        })
        .returning();

      const [spouseAcct] = await tx
        .insert(accounts)
        .values({
          ...targetRest,
          value: spouseValueRounded.toFixed(2),
          basis: spouseBasisRounded.toFixed(2),
          rothValue: spouseRothValueRounded.toFixed(2),
          name: `${target.name} (Spouse share)`,
        })
        .returning();

      // Insert account_owners rows for each split account.
      if (clientAcct) {
        await tx.insert(accountOwners).values({
          accountId: clientAcct.id,
          familyMemberId: clientFmId,
          entityId: null,
          percent: "1.0000",
        });
      }
      if (spouseAcct) {
        await tx.insert(accountOwners).values({
          accountId: spouseAcct.id,
          familyMemberId: spouseFmId,
          entityId: null,
          percent: "1.0000",
        });
      }

      // NOTE: deleting the original account cascades to beneficiary_designations,
      // account_asset_allocations, and transfers (per schema FK ON DELETE CASCADE).
      // For brokerage/IRA/cash joints these tables are typically empty; for accounts
      // with custom asset allocations, those rows are lost. Tracked in
      // future-work/schema.md as "split should copy asset_allocations proportionally".
      await tx
        .delete(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));

      return {
        clientAccountId: clientAcct!.id,
        spouseAccountId: spouseAcct!.id,
      };
    });

    const [clientSnapshot, spouseSnapshot] = await Promise.all([
      toAccountSnapshot({
        ...target,
        id: result.clientAccountId,
        value: clientValueRounded.toFixed(2),
        basis: clientBasisRounded.toFixed(2),
        rothValue: clientRothValueRounded.toFixed(2),
      }),
      toAccountSnapshot({
        ...target,
        id: result.spouseAccountId,
        value: spouseValueRounded.toFixed(2),
        basis: spouseBasisRounded.toFixed(2),
        rothValue: spouseRothValueRounded.toFixed(2),
      }),
    ]);
    await Promise.all([
      recordDelete({
        action: "account.delete",
        resourceType: "account",
        resourceId: accountId,
        clientId: id,
        firmId,
        snapshot,
      }),
      recordCreate({
        action: "account.create",
        resourceType: "account",
        resourceId: result.clientAccountId,
        clientId: id,
        firmId,
        snapshot: clientSnapshot,
      }),
      recordCreate({
        action: "account.create",
        resourceType: "account",
        resourceId: result.spouseAccountId,
        clientId: id,
        firmId,
        snapshot: spouseSnapshot,
      }),
    ]);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts/[accountId]/split error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
