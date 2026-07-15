import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { getBranding } from "@/lib/branding/db";
import { resolveFirmName } from "@/lib/branding/branding";
import { hasUnsubmittedPrefilledForm } from "@/lib/intake/queries";
import type { PortalMeDTO } from "@/lib/portal/contracts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();

    const [row] = await db
      .select({
        firmId: clients.firmId,
        crmHouseholdId: clients.crmHouseholdId,
        portalEditEnabled: clients.portalEditEnabled,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Display name/email from the household's primary contact — mirrors
    // src/app/(portal)/portal/layout.tsx.
    let displayName = "";
    let email = "";
    if (row.crmHouseholdId) {
      const [primary] = await db
        .select({
          firstName: crmHouseholdContacts.firstName,
          lastName: crmHouseholdContacts.lastName,
          email: crmHouseholdContacts.email,
        })
        .from(crmHouseholdContacts)
        .where(
          and(
            eq(crmHouseholdContacts.householdId, row.crmHouseholdId),
            eq(crmHouseholdContacts.role, "primary"),
          ),
        )
        .limit(1);
      if (primary) {
        displayName = `${primary.firstName} ${primary.lastName}`.trim();
        email = primary.email ?? "";
      }
    }

    const [branding, intakePending] = await Promise.all([
      getBranding(row.firmId),
      hasUnsubmittedPrefilledForm(clientId),
    ]);
    const firmName = await resolveFirmName(row.firmId, branding?.displayName ?? null);

    const dto: PortalMeDTO = {
      client: { id: clientId, displayName, email },
      firm: { name: firmName, logoUrl: branding?.logoUrl ?? null },
      mode,
      editEnabled: row.portalEditEnabled ?? false,
      intakePending,
    };
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
