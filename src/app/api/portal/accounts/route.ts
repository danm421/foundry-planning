import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  accountCategoryEnum,
  accountSubTypeEnum,
  clients,
  scenarios,
} from "@/db/schema";
import {
  authErrorResponse,
  requireClientPortalAccess,
} from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import {
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
} from "@/lib/ownership";
import { validateTrustOnlyEntityOwners } from "@/lib/portal/validate-trust-owners";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  last4?: string | null;
  category?: string;
  subType?: string;
  value?: string;
  owners?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (!body.category) {
      return NextResponse.json({ error: "category required" }, { status: 400 });
    }
    if (!(accountCategoryEnum.enumValues as readonly string[]).includes(body.category)) {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    if (
      body.subType !== undefined &&
      !(accountSubTypeEnum.enumValues as readonly string[]).includes(body.subType)
    ) {
      return NextResponse.json({ error: "invalid subType" }, { status: 400 });
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
    const rulesErr = validateAccountOwnershipRules(
      ownersResult.owners,
      body.subType ?? "other",
      false,
    );
    if (rulesErr) {
      return NextResponse.json({ error: rulesErr.error }, { status: 400 });
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

    let insertedId = "";
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(accounts)
        .values({
          clientId,
          scenarioId: scenario.id,
          name: body.name!,
          category: body.category as typeof accounts.$inferInsert.category,
          subType: (body.subType ?? "other") as typeof accounts.$inferInsert.subType,
          value: body.value ?? "0",
          accountNumberLast4: body.last4 ?? null,
        })
        .returning();
      insertedId = row.id;
      for (const o of ownersResult.owners) {
        await tx.insert(accountOwners).values({
          accountId: row.id,
          familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
          entityId: o.kind === "entity" ? o.entityId : null,
          percent: o.percent.toString(),
        });
      }
    });

    await recordCreate({
      action: "portal.account.create",
      resourceType: "account",
      resourceId: insertedId,
      clientId,
      firmId: client.firmId,
      actorKind: "client",
      snapshot: {
        name: body.name,
        category: body.category,
        subType: body.subType ?? "other",
        value: body.value ?? "0",
        last4: body.last4 ?? null,
      },
    });

    return NextResponse.json({ ok: true, id: insertedId });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
