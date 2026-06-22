import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, familyMembers, familyRelationshipEnum } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type Relationship = (typeof familyRelationshipEnum.enumValues)[number];

type Body = {
  firstName?: string;
  lastName?: string | null;
  relationship?: string;
  dateOfBirth?: string | null;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.firstName || body.firstName.trim() === "") {
      return NextResponse.json({ error: "firstName required" }, { status: 400 });
    }

    if (
      body.relationship !== undefined &&
      !(familyRelationshipEnum.enumValues as readonly string[]).includes(body.relationship)
    ) {
      return NextResponse.json({ error: "invalid relationship" }, { status: 400 });
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const relationship: Relationship = (body.relationship as Relationship) ?? "child";

    const [inserted] = await db
      .insert(familyMembers)
      .values({
        clientId,
        firstName: body.firstName.trim(),
        lastName: body.lastName ?? null,
        relationship,
        dateOfBirth: body.dateOfBirth ?? null,
      })
      .returning();

    await recordCreate({
      action: "portal.family.create",
      resourceType: "family_member",
      resourceId: inserted.id,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: {
        firstName: inserted.firstName,
        lastName: inserted.lastName,
        relationship: inserted.relationship,
        dateOfBirth: inserted.dateOfBirth,
      },
    });

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
