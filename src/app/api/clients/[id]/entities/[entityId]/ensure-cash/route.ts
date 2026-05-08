import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  entities,
  scenarios,
  accounts,
  accountOwners,
  clients,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

/**
 * Belt-and-suspenders self-heal: ensure that every base-case scenario for
 * this entity has a default-checking cash account owned by the entity at
 * 100%. The Phase 1 backfill script (`scripts/backfill-entity-cash-accounts.ts`)
 * is the source of truth for existing data; this endpoint covers the gap
 * for entities created after the backfill but before the entity-creation
 * flow's account provisioning is fully relied upon.
 *
 * Idempotent: re-runs are no-ops once every base scenario has a default-
 * checking account owned by this entity.
 *
 * Errors are returned as JSON, but the FlowsTab caller fires-and-forgets,
 * so silent failure is acceptable — the backfill remains the source of
 * truth and any orphaned entity will simply continue to lack a cash
 * account until manually corrected.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, entityId } = await params;

    // Org-scoping: client must belong to caller's firm.
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Entity must belong to client.
    const [ent] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.clientId, id)));
    if (!ent) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const baseScenarios = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

    let created = 0;
    for (const s of baseScenarios) {
      const owned = await db
        .select({ id: accounts.id })
        .from(accounts)
        .innerJoin(accountOwners, eq(accountOwners.accountId, accounts.id))
        .where(
          and(
            eq(accounts.scenarioId, s.id),
            eq(accountOwners.entityId, ent.id),
            eq(accounts.isDefaultChecking, true),
          ),
        );
      if (owned.length > 0) continue;

      // Wrap account + owner inserts in a transaction so the deferred
      // `account_owners_default_checking_check` (and the sum-to-100%
      // trigger) see the final state at COMMIT. Without the transaction
      // each statement auto-commits and the deferred trigger fires
      // before the owner row exists.
      await db.transaction(async (tx) => {
        const [a] = await tx
          .insert(accounts)
          .values({
            clientId: id,
            scenarioId: s.id,
            name: `${ent.name} — Cash`,
            category: "cash",
            subType: "checking",
            value: "0",
            basis: "0",
            growthRate: null,
            rmdEnabled: false,
            isDefaultChecking: true,
          })
          .returning({ id: accounts.id });

        await tx.insert(accountOwners).values({
          accountId: a.id,
          entityId: ent.id,
          familyMemberId: null,
          percent: "1.0000",
        });
      });
      created++;
    }

    return NextResponse.json({ created });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "POST /api/clients/[id]/entities/[entityId]/ensure-cash error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
