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

    let insertedId = "";
    await db.transaction(async (tx) => {
      // Held-flat row, exactly like the Plaid commit path: no term and no
      // payment, so `isHeldFlatLiability()` keeps the balance on the projection
      // instead of amortizing an empty schedule to zero. The portal collects
      // name/type/balance only — rate and term are the advisor's to set, and
      // storing a rate with no term would look modelled while doing nothing.
      const [row] = await tx
        .insert(liabilities)
        .values({
          clientId,
          scenarioId: scenario.id,
          name: body.name!,
          liabilityType: body.liabilityType as typeof liabilities.$inferInsert.liabilityType,
          balance,
          interestRate: "0",
          monthlyPayment: null,
          termMonths: null,
          startYear: new Date().getFullYear(),
          startMonth: 1,
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
      },
    });

    return NextResponse.json({ ok: true, id: insertedId });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
