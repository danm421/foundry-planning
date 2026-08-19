import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { getBranding } from "@/lib/branding/db";
import { resolveFirmName } from "@/lib/branding/branding";
import { resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";
import { hasUnsubmittedPrefilledForm } from "@/lib/intake/queries";
import { portalFeatureColumns } from "@/lib/portal/load-features";
import { toPortalFeatures } from "@/lib/portal/features";
import { portalGreetingName } from "@/lib/portal/greeting-name";
import type { PortalMeDTO } from "@/lib/portal/contracts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();

    const [row] = await db
      .select({
        firmId: clients.firmId,
        advisorId: clients.advisorId,
        crmHouseholdId: clients.crmHouseholdId,
        portalEditEnabled: clients.portalEditEnabled,
        // Spread onto the row this already reads rather than calling
        // `loadPortalFeatures` — React.cache() does not dedupe inside a route
        // handler, so that would be a second round-trip for columns we are
        // already selecting.
        ...portalFeatureColumns,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Two separate questions, both answered off one read of the household's
    // greetable contacts:
    //   displayName/email — who is signed in (the primary contact alone),
    //   greetingName      — who the welcome line names, which is the whole
    //                       household ("John & Jane") exactly as the web
    //                       chrome renders it via portalGreetingName. Greeting
    //                       only the primary was why a two-person household
    //                       saw a different name on the phone than on the web.
    // Mirrors src/app/(portal)/portal/layout.tsx.
    let displayName = "";
    let email = "";
    let greetingName = "";
    if (row.crmHouseholdId) {
      const contacts = await db
        .select({
          role: crmHouseholdContacts.role,
          firstName: crmHouseholdContacts.firstName,
          lastName: crmHouseholdContacts.lastName,
          preferredName: crmHouseholdContacts.preferredName,
          email: crmHouseholdContacts.email,
        })
        .from(crmHouseholdContacts)
        .where(
          and(
            eq(crmHouseholdContacts.householdId, row.crmHouseholdId),
            inArray(crmHouseholdContacts.role, ["primary", "spouse"]),
          ),
        )
        // Roles are unique per household (one primary, one spouse), so this
        // is at most two rows; portalGreetingName orders them, not the query.
        .limit(2);
      greetingName = portalGreetingName(contacts);
      const primary = contacts.find((c) => c.role === "primary");
      if (primary) {
        displayName = `${primary.firstName} ${primary.lastName}`.trim();
        email = primary.email ?? "";
      }
    }

    const [branding, intakePending] = await Promise.all([
      resolveIntakeBrandingForClient(row.firmId, row.advisorId),
      hasUnsubmittedPrefilledForm(clientId),
    ]);

    // resolveIntakeBrandingForClient returns null whenever there is no usable
    // logo ANYWHERE (advisor override or firm) — the right signal for chrome
    // to fall back to the Foundry lockup. But a firm's real name doesn't
    // depend on having a logo: a firm that has simply never uploaded one
    // still has a real name, so resolve it independently here rather than
    // showing the generic default for every logo-less firm. Kept lazy so the
    // branded path never pays for a getBranding round-trip it won't read.
    let name: string;
    if (branding) {
      name = branding.firmName;
    } else {
      const legacyBranding = await getBranding(row.firmId);
      name = await resolveFirmName(row.firmId, legacyBranding?.displayName ?? null);
    }

    const dto: PortalMeDTO = {
      client: { id: clientId, displayName, email },
      firm: { name, logoUrl: branding?.logoUrl ?? null },
      mode,
      editEnabled: row.portalEditEnabled ?? false,
      intakePending,
      features: toPortalFeatures(row),
      greetingName,
    };
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
