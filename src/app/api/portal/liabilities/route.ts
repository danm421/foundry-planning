import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  liabilities,
  liabilityOwners,
  liabilityTypeEnum,
  clients,
  scenarios,
} from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { validateOwnersShape, validateOwnersTenant } from "@/lib/ownership";
import { validateTrustOnlyEntityOwners } from "@/lib/portal/validate-trust-owners";
import { LOAN_SCHEDULE_START_MONTH, resolveLoanDetails } from "@/lib/portal/loan-details";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

// Mirrors src/app/api/portal/accounts/route.ts POST for the debt side: the same
// resolvePortalClient + requirePortalActiveSubscription + requireEditEnabled
// guards, the same base-scenario lookup, the same owners[] validation, the same
// portal.* audit + viaPreview act-as tagging.

type Body = {
  name?: string;
  liabilityType?: string;
  balance?: string;
  owners?: unknown;
  /** Annual FRACTION ("0.0649"), matching liabilities.interest_rate. */
  interestRate?: unknown;
  monthlyPayment?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (!body.liabilityType) {
      return NextResponse.json({ error: "liabilityType required" }, { status: 400 });
    }
    if (!(liabilityTypeEnum.enumValues as readonly string[]).includes(body.liabilityType)) {
      return NextResponse.json({ error: "invalid liabilityType" }, { status: 400 });
    }

    const ownersResult = validateOwnersShape(body.owners);
    if ("error" in ownersResult) {
      return NextResponse.json({ error: ownersResult.error }, { status: 400 });
    }
    const tenantErr = await validateOwnersTenant(ownersResult.owners, clientId);
    if (tenantErr) {
      return NextResponse.json({ error: tenantErr.error }, { status: 400 });
    }
    const trustErr = await validateTrustOnlyEntityOwners(ownersResult.owners, clientId);
    if (trustErr) {
      return NextResponse.json({ error: trustErr.error }, { status: 400 });
    }

    const [scenario] = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1);
    if (!scenario) {
      return NextResponse.json({ error: "No base scenario" }, { status: 404 });
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const balance = body.balance ?? "0";

    // Payment terms are optional: without them the row stays held flat, exactly
    // as before. With them the engine amortizes the debt — the only way a Plaid
    // auto loan (whose rate Plaid never sends) gets paid down in the projection.
    const loan = resolveLoanDetails(Number(balance), body.liabilityType, body);
    if (!loan.ok) {
      return NextResponse.json({ error: loan.error }, { status: 400 });
    }

    let insertedId = "";
    await db.transaction(async (tx) => {
      // Without payment terms this is a held-flat row, exactly like the Plaid
      // commit path: no term and no payment, so `isHeldFlatLiability()` keeps
      // the balance on the projection instead of amortizing an empty schedule
      // to zero. With them, the schedule starts THIS YEAR at today's balance
      // (balanceAsOf left null => zero elapsed months => the back-calculated
      // original balance is the balance itself), so the derived term is the
      // REMAINING term rather than an original one. See
      // LOAN_SCHEDULE_START_MONTH for why the month is pinned.
      const [row] = await tx
        .insert(liabilities)
        .values({
          clientId,
          scenarioId: scenario.id,
          name: body.name!,
          liabilityType: body.liabilityType as typeof liabilities.$inferInsert.liabilityType,
          balance,
          ...loan.columns,
          startYear: new Date().getFullYear(),
          startMonth: LOAN_SCHEDULE_START_MONTH,
          isInterestDeductible: false,
        })
        .returning();
      insertedId = row.id;
      for (const o of ownersResult.owners) {
        await tx.insert(liabilityOwners).values({
          liabilityId: row.id,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    });

    await recordCreate({
      action: "portal.liability.create",
      resourceType: "liability",
      resourceId: insertedId,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: {
        name: body.name,
        liabilityType: body.liabilityType,
        balance,
        ...loan.columns,
      },
    });

    return NextResponse.json({ ok: true, id: insertedId });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
