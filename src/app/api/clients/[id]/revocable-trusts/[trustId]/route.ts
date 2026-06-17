import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { revocableTrusts, accounts } from "@/db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { revocableTrustUpsertSchema } from "@/lib/schemas/revocable-trusts";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string) {
  return verifyClientAccess(clientId);
}

/** Verify the trust row belongs to clientId (and thus firmId by FK chain).
 *  Returns the trust row or null. */
async function verifyTrust(trustId: string, clientId: string) {
  const [trust] = await db
    .select()
    .from(revocableTrusts)
    .where(
      and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, clientId))
    );
  return trust ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; trustId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, trustId } = await params;

    const access = await verifyClient(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const trust = await verifyTrust(trustId, id);
    if (!trust) {
      return NextResponse.json({ error: "Trust not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = revocableTrustUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 }
      );
    }
    const { name, accountIds } = parsed.data;

    // Update the trust name
    const [updated] = await db
      .update(revocableTrusts)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, id)))
      .returning();

    // Membership diff:
    // (a) Untag accounts currently in this trust but not in the new accountIds list
    // (b) Tag accounts in the new accountIds list

    // (a) Clear revocable_trust_id on accounts tagged to this trust that are no
    //     longer in accountIds. If accountIds is empty, untag ALL currently tagged
    //     accounts for this trust.
    if (accountIds.length > 0) {
      await db
        .update(accounts)
        .set({ revocableTrustId: null })
        .where(
          and(
            eq(accounts.clientId, id),
            eq(accounts.revocableTrustId, trustId),
            notInArray(accounts.id, accountIds)
          )
        );
    } else {
      // Empty accountIds: untag all accounts currently in this trust
      await db
        .update(accounts)
        .set({ revocableTrustId: null })
        .where(
          and(
            eq(accounts.clientId, id),
            eq(accounts.revocableTrustId, trustId)
          )
        );
    }

    // (b) Tag the new accountIds (scope to clientId)
    if (accountIds.length > 0) {
      await db
        .update(accounts)
        .set({ revocableTrustId: trustId })
        .where(
          and(
            eq(accounts.clientId, id),
            inArray(accounts.id, accountIds)
          )
        );
    }

    // Fetch the final account membership for the response
    const taggedAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.revocableTrustId, trustId)
        )
      );
    const finalAccountIds = taggedAccounts.map((a) => a.id);

    await recordAudit({
      action: "revocable_trust.update",
      resourceType: "revocable_trust",
      resourceId: trustId,
      clientId: id,
      firmId,
      metadata: { name, accountIds: finalAccountIds },
    });

    return NextResponse.json({ ...updated, accountIds: finalAccountIds });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/revocable-trusts/[trustId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; trustId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, trustId } = await params;

    const access = await verifyClient(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const trust = await verifyTrust(trustId, id);
    if (!trust) {
      return NextResponse.json({ error: "Trust not found" }, { status: 404 });
    }

    // Delete the trust row. FK ON DELETE SET NULL on accounts.revocable_trust_id
    // untags all member accounts automatically.
    await db
      .delete(revocableTrusts)
      .where(and(eq(revocableTrusts.id, trustId), eq(revocableTrusts.clientId, id)));

    await recordAudit({
      action: "revocable_trust.delete",
      resourceType: "revocable_trust",
      resourceId: trustId,
      clientId: id,
      firmId,
      metadata: { name: trust.name },
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/revocable-trusts/[trustId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
