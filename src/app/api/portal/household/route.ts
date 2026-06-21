import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { requireClientPortalAccess, authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

type ContactPatch = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

type Body = { primary?: ContactPatch; spouse?: ContactPatch };

export async function PUT(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;

    const [client] = await db
      .select({ firmId: clients.firmId, crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    for (const role of ["primary", "spouse"] as const) {
      const patch = body[role];
      if (!patch) continue;

      const [existing] = await db
        .select()
        .from(crmHouseholdContacts)
        .where(
          and(
            eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
            eq(crmHouseholdContacts.role, role),
          ),
        )
        .limit(1);

      if (!existing) continue;

      // Build explicit before/after snapshots with only the editable fields.
      // This keeps the audit snapshot type-safe (EntitySnapshot = Record<string, AuditValue>)
      // and avoids passing Date objects (createdAt/updatedAt) which are not AuditValue.
      const editable = (c: {
        firstName: string;
        lastName: string | null;
        email: string | null;
        phone: string | null;
      }) => ({
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
      });

      const before = editable(existing);
      const after = { ...before, ...patch };

      await db
        .update(crmHouseholdContacts)
        .set(patch)
        .where(eq(crmHouseholdContacts.id, existing.id));

      await recordUpdate({
        action: "portal.household.update",
        resourceType: "crm_household_contact",
        resourceId: existing.id,
        clientId,
        firmId: client.firmId,
        actorKind: "client",
        before,
        after,
        fieldLabels: {
          firstName: { label: "First name", format: "text" },
          lastName: { label: "Last name", format: "text" },
          email: { label: "Email", format: "text" },
          phone: { label: "Phone", format: "text" },
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
