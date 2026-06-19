import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, familyMembers } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type Body = {
  firstName?: string;
  lastName?: string | null;
  relationship?: "child" | "parent" | "sibling" | "other";
  dateOfBirth?: string | null;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.firstName || body.firstName.trim() === "") {
      return NextResponse.json({ error: "firstName required" }, { status: 400 });
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [inserted] = await db
      .insert(familyMembers)
      .values({
        clientId,
        firstName: body.firstName.trim(),
        lastName: body.lastName ?? null,
        relationship: body.relationship ?? "child",
        dateOfBirth: body.dateOfBirth ?? null,
      })
      .returning();

    await recordCreate({
      action: "portal.family.create",
      resourceType: "family_member",
      resourceId: inserted.id,
      clientId,
      firmId: client.firmId,
      actorKind: "client",
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
