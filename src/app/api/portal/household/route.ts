import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import { loadPortalHousehold } from "@/lib/portal/load-profile-data";
import type { HouseholdContactPatch } from "@/lib/portal/contracts";
import { syncHouseholdNameFromContacts } from "@/lib/crm/sync-household-name";

export const dynamic = "force-dynamic";

// Shared with the mobile client. email/phone are nullable columns and the
// portal card lets a client clear them, so the patch carries `null` — not
// `""` — for "no longer on file"; first/last name are NOT NULL and clear to "".
type ContactPatch = HouseholdContactPatch;

type Body = { primary?: ContactPatch; spouse?: ContactPatch };

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    const dto = await loadPortalHousehold(clientId);
    if (!dto) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;

    // Name guards. `first_name`/`last_name` are NOT NULL and both feed
    // `syncHouseholdNameFromContacts` below, so a blank first name would rename
    // the household to nothing across the CRM, and a `null` from a client built
    // against an older contract would reach Postgres as a constraint violation
    // (a 500) instead of a clean 400.
    for (const role of ["primary", "spouse"] as const) {
      const patch = body[role];
      if (!patch) continue;
      // `null` has to be rejected before the emptiness check below, or
      // `null.trim()` throws and the client gets exactly the 500 this guard
      // exists to prevent.
      if (patch.firstName === null || patch.lastName === null) {
        return NextResponse.json(
          { error: "Name cannot be cleared" },
          { status: 400 },
        );
      }
      if (patch.firstName !== undefined && patch.firstName.trim() === "") {
        return NextResponse.json(
          { error: "First name is required" },
          { status: 400 },
        );
      }
    }

    const [client] = await db
      .select({ firmId: clients.firmId, crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Both loop roles feed the derived household name; sync once after the
    // loop rather than per-role so a two-role patch writes the name once.
    let nameChanged = false;

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

      // Pick the writable fields rather than passing the parsed body through.
      // `patch` is unvalidated JSON and `crm_household_contacts` also holds
      // householdId, role, ssnLast4 and notes — handing it straight to `.set()`
      // let a client write any column of their own contact row, including
      // moving it into another firm's household.
      const update: ContactPatch = {};
      if (patch.firstName !== undefined) update.firstName = patch.firstName;
      if (patch.lastName !== undefined) update.lastName = patch.lastName;
      if (patch.email !== undefined) update.email = patch.email;
      if (patch.phone !== undefined) update.phone = patch.phone;
      if (Object.keys(update).length === 0) continue;

      const before = editable(existing);
      const after = { ...before, ...update };

      await db
        .update(crmHouseholdContacts)
        .set(update)
        .where(eq(crmHouseholdContacts.id, existing.id));

      if (update.firstName !== undefined || update.lastName !== undefined) {
        nameChanged = true;
      }

      await recordUpdate({
        action: "portal.household.update",
        resourceType: "crm_household_contact",
        resourceId: existing.id,
        clientId,
        firmId: client.firmId,
        actorKind: mode === "advisor" ? "advisor" : "client",
        extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
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

    if (nameChanged) {
      // Derived-data maintenance. This handler is non-transactional and the
      // contact patch above has already committed, so letting a sync failure
      // propagate would report a save that actually succeeded — inviting a
      // client retry that re-runs the contact UPDATE and writes a duplicate
      // audit row. Mirrors the recordHouseholdOpen non-fatal wrap in
      // POST /api/clients (src/app/api/clients/route.ts).
      try {
        await syncHouseholdNameFromContacts(db, client.crmHouseholdId);
      } catch (syncErr) {
        console.error("Portal household name sync failed:", syncErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
