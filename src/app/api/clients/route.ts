import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and, asc, isNull, or, inArray, sql } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { resolveVisibleAdvisorIds, advisorScopeCondition } from "@/lib/visibility";
import { resolveSharesForRecipient } from "@/lib/clients/shared-access";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { requireActiveSubscription } from "@/lib/authz";
import { parseBody } from "@/lib/schemas/common";
import { clientCreateSchema, clientContactInfoSchema } from "@/lib/schemas/resources";
import { recordHouseholdOpen } from "@/lib/crm/households";
import { mirrorContactToCrm } from "@/lib/clients/mirror-contact-to-crm";
import { createClientForHousehold } from "@/lib/clients/create-client";

// Contact fields the POST body may carry. We extract them from the parsed
// body and atomically mirror them onto the CRM primary/spouse contact rows
// inside the same transaction as the clients insert — so a partial failure
// can't leave the planning client ahead of (or behind) its CRM contact info.
//
// Single source of truth: the zod schema. Adding a contact field to
// clientContactInfoSchema auto-flows into this POST mirror allowlist.
const CONTACT_FIELDS = Object.keys(clientContactInfoSchema.shape) as Array<
  keyof typeof clientContactInfoSchema.shape
>;

export const dynamic = "force-dynamic";

// GET /api/clients — list all clients for the firm
export async function GET() {
  try {
    const firmId = await requireOrgId();
    const { userId, orgRole } = await auth();
    const visible = await resolveVisibleAdvisorIds(userId ?? "", orgRole, firmId);
    const scope = advisorScopeCondition(clients.advisorId, visible);

    // Single share-map expansion — used for both the inArray filter and tagging.
    const details = await resolveSharesForRecipient(userId ?? "");
    const sharedIds = [...new Set(details.map((d) => d.clientId))];

    // Tight projection: the list UI only needs identity + the fields
    // shown in the table. Identity (firstName/lastName/spouse names) now lives
    // on CRM contacts joined via crm_household_id. Sort order keys off the
    // primary contact's last+first name.
    const primaryContact = crmHouseholdContacts;
    const rows = await db
      .select({
        id: clients.id,
        firmId: clients.firmId,
        firstName: primaryContact.firstName,
        lastName: primaryContact.lastName,
        retirementAge: clients.retirementAge,
        planEndAge: clients.planEndAge,
        createdAt: clients.createdAt,
        crmHouseholdId: clients.crmHouseholdId,
      })
      .from(clients)
      .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
      .leftJoin(
        primaryContact,
        and(
          eq(primaryContact.householdId, clients.crmHouseholdId),
          eq(primaryContact.role, "primary"),
        ),
      )
      .where(
        and(
          isNull(crmHouseholds.deletedAt),
          or(
            and(eq(clients.firmId, firmId), ...(scope ? [scope] : [])),
            sharedIds.length ? inArray(clients.id, sharedIds) : sql`false`,
          ),
        ),
      )
      .orderBy(asc(primaryContact.lastName), asc(primaryContact.firstName));

    // Tag each row with access:"own"|"shared" and sharedBy (display name of
    // the sharing advisor) for shared rows. Own-firm rows always get sharedBy:null.
    const ownerByClient = new Map(details.map((d) => [d.clientId, d.ownerUserId]));
    const names = await resolveActors([...new Set(details.map((d) => d.ownerUserId))]);
    const tagged = rows.map((r) => {
      const owner = ownerByClient.get(r.id);
      return {
        ...r,
        access: r.firmId === firmId ? "own" : "shared",
        sharedBy: owner ? (names.get(owner)?.name ?? null) : null,
      };
    });

    return NextResponse.json(tagged);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients — create a new client with base case scenario + plan settings.
//
// Identity (name, DOB, email, address) lives in the CRM now. The caller picks a
// CRM household (`crmHouseholdId`) and sends planning-only fields. We read the
// primary + spouse contacts from the CRM and dual-write the legacy `clients`
// columns (firstName/lastName/dateOfBirth/...) so the still-notNull schema
// columns are satisfied — Phase 9 will drop those columns and remove the
// dual-write.
export async function POST(request: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await requireActiveSubscription();

    const parsed = await parseBody(clientCreateSchema, request);
    if (!parsed.ok) return parsed.response;
    const {
      crmHouseholdId,
      retirementAge,
      retirementMonth,
      lifeExpectancy,
      filingStatus,
      spouseRetirementAge,
      spouseRetirementMonth,
      spouseLifeExpectancy,
    } = parsed.data;

    // Load the CRM household + contacts. Without a primary contact we can't
    // populate the still-notNull legacy columns, so reject early with 422.
    const household = await db.query.crmHouseholds.findFirst({
      where: and(
        eq(crmHouseholds.id, crmHouseholdId),
        eq(crmHouseholds.firmId, firmId),
      ),
      with: { contacts: true },
    });
    if (!household) {
      return NextResponse.json(
        { error: "CRM household not found" },
        { status: 404 },
      );
    }
    const primary = household.contacts.find(
      (c: typeof crmHouseholdContacts.$inferSelect) => c.role === "primary",
    );
    const spouse = household.contacts.find(
      (c: typeof crmHouseholdContacts.$inferSelect) => c.role === "spouse",
    );
    if (!primary || !primary.dateOfBirth) {
      return NextResponse.json(
        {
          error:
            "CRM household must have a primary contact with a date of birth before a planning client can be created.",
        },
        { status: 422 },
      );
    }

    // Extract any contact fields from the parsed body so we can mirror them
    // onto the CRM contact rows. The mirror stays in the route (not the create
    // service) — it's POST-body-specific and runs after the create so the new
    // planning client and its CRM contact info land together.
    const contactPatch: Record<string, unknown> = {};
    const incoming = parsed.data as Record<string, unknown>;
    for (const key of CONTACT_FIELDS) {
      if (key in incoming) contactPatch[key] = incoming[key];
    }

    // Create the planning client + all default seeds (scenario, plan settings,
    // family members, household cash, living expenses, SS incomes, audit) via
    // the shared service. The standalone service path wraps every insert in its
    // own transaction. We preserve today's behavior: advisorId comes from the
    // household, so the route passes household.advisorId = userId.
    const { clientId } = await createClientForHousehold({
      household: {
        id: crmHouseholdId,
        firmId,
        advisorId: userId,
        state: household.state,
      },
      primaryContact: {
        firstName: primary.firstName,
        lastName: primary.lastName,
        dateOfBirth: primary.dateOfBirth,
      },
      spouseContact: spouse
        ? {
            firstName: spouse.firstName,
            lastName: spouse.lastName,
            dateOfBirth: spouse.dateOfBirth ?? null,
          }
        : null,
      retirementAge: Number(retirementAge),
      retirementMonth: retirementMonth != null ? Number(retirementMonth) : undefined,
      lifeExpectancy: Number(lifeExpectancy),
      spouseRetirementAge,
      spouseRetirementMonth,
      spouseLifeExpectancy,
      filingStatus,
    });

    // Mirror any contact-only fields from the POST body onto the CRM contacts.
    // No household-name sync after this mirror: contactPatch's keys come from
    // CONTACT_FIELDS, which derives from clientContactInfoSchema — a `.strict()`
    // schema (src/lib/schemas/resources.ts) that carries only contact-detail
    // fields (email/phone/address/...), never firstName/lastName/spouseName/
    // spouseLastName. So this route structurally cannot change a household
    // name. If a name field is ever added to clientContactInfoSchema, this
    // call site becomes name-changing and needs a syncHouseholdNameFromContacts
    // call afterward, the way PUT /api/clients/[id] does (mirrorContactToCrm
    // there is followed by a sync — see IDENTITY_FIELDS in ./[id]/route.ts).
    if (Object.keys(contactPatch).length > 0) {
      await db.transaction(async (tx) => {
        await mirrorContactToCrm(tx, crmHouseholdId, contactPatch);
      });
    }

    // Re-fetch the created client so the response keeps its existing 201 shape.
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId));

    // Surface the just-created household in this advisor's "Recently opened"
    // clients view (the default list). That view is driven by crm_household_views,
    // which is otherwise only written when a row-action pill hits /open — and the
    // brand-new-household create flows never click a pill. Record the open here at
    // the creation chokepoint so the household shows up immediately. Non-fatal: a
    // view-write failure must not fail client creation.
    try {
      await recordHouseholdOpen(crmHouseholdId, userId);
    } catch (viewErr) {
      console.error("Failed to record household open on client create:", viewErr);
    }

    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

