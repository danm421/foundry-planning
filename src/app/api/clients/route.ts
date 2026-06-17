import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts,
  expenses,
  incomes,
  familyMembers,
  crmHouseholds,
  crmHouseholdContacts,
} from "@/db/schema";
import { eq, and, asc, isNull, or, inArray, sql } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { resolveVisibleAdvisorIds, advisorScopeCondition } from "@/lib/visibility";
import { resolveSharedClientAccess, resolveSharesForRecipient } from "@/lib/clients/shared-access";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { requireActiveSubscription } from "@/lib/authz";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { parseBody } from "@/lib/schemas/common";
import { clientCreateSchema, clientContactInfoSchema } from "@/lib/schemas/resources";
import { recordAudit } from "@/lib/audit";
import { recordHouseholdOpen } from "@/lib/crm/households";
import { mirrorContactToCrm } from "@/lib/clients/mirror-contact-to-crm";

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

    // Fetch the set of client ids shared to this user from other firms.
    const { sharedClientIds } = await resolveSharedClientAccess(userId ?? "");
    const sharedIds = [...sharedClientIds];

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
    const details = await resolveSharesForRecipient(userId ?? "");
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

    const firstName = primary.firstName;
    const lastName = primary.lastName;
    const dateOfBirth = primary.dateOfBirth;
    const spouseName = spouse?.firstName ?? null;
    const spouseLastName = spouse?.lastName ?? null;
    const spouseDob = spouse?.dateOfBirth ?? null;

    // When the household has a spouse, their planning fields must never be blank
    // — default retirement to 65 and life expectancy to 95. Some creation paths
    // (e.g. AI import) never surface these inputs, so we default here at the
    // single write chokepoint rather than in each form. No spouse → stay null.
    const hasSpouse = spouse != null;
    const effectiveSpouseRetirementAge = hasSpouse
      ? Number(spouseRetirementAge ?? 65)
      : null;
    const effectiveSpouseRetirementMonth = hasSpouse
      ? Number(spouseRetirementMonth ?? 1)
      : null;
    const effectiveSpouseLifeExpectancy = hasSpouse
      ? Number(spouseLifeExpectancy ?? 95)
      : null;

    // Plan horizon is the year the last spouse dies; plan_end_age is derived
    // from client + spouse life expectancies.
    const planEndAge = computePlanEndAge({
      clientDob: dateOfBirth,
      clientLifeExpectancy: Number(lifeExpectancy),
      spouseDob: spouseDob ?? null,
      spouseLifeExpectancy: effectiveSpouseLifeExpectancy,
    });

    const currentYear = new Date().getFullYear();

    // Extract any contact fields from the parsed body so we can atomically
    // mirror them onto the CRM contact rows inside the same transaction as
    // the clients insert.
    const contactPatch: Record<string, unknown> = {};
    const incoming = parsed.data as Record<string, unknown>;
    for (const key of CONTACT_FIELDS) {
      if (key in incoming) contactPatch[key] = incoming[key];
    }

    // Insert client — identity lives on CRM contacts (linked via crmHouseholdId),
    // so the clients row only carries planning fields. Wrapped in a transaction
    // alongside the contact mirror so a partial failure can't leave the
    // planning row out of sync with CRM. The downstream seeds (scenario,
    // plan settings, family members, accounts, expenses, incomes, audit)
    // are intentionally outside the tx — they're idempotent and not
    // load-bearing for contact-info correctness.
    const client = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(clients)
        .values({
          firmId,
          advisorId: userId,
          crmHouseholdId,
          retirementAge: Number(retirementAge),
          retirementMonth: retirementMonth != null ? Number(retirementMonth) : 1,
          planEndAge,
          lifeExpectancy: Number(lifeExpectancy),
          filingStatus,
          spouseRetirementAge: effectiveSpouseRetirementAge,
          spouseRetirementMonth: effectiveSpouseRetirementMonth,
          spouseLifeExpectancy: effectiveSpouseLifeExpectancy,
        })
        .returning();
      if (Object.keys(contactPatch).length > 0) {
        await mirrorContactToCrm(tx, crmHouseholdId, contactPatch);
      }
      return c;
    });

    // Insert base case scenario
    const [scenario] = await db
      .insert(scenarios)
      .values({
        clientId: client.id,
        name: "Base Case",
        isBaseCase: true,
      })
      .returning();

    // Insert default plan settings
    await db.insert(planSettings).values({
      clientId: client.id,
      scenarioId: scenario.id,
      planStartYear: currentYear,
      planEndYear: new Date(dateOfBirth).getFullYear() + planEndAge,
    });

    // Seed household family_members rows (role='client', and 'spouse' if married).
    // OwnershipEditor's preset buttons and defaultOwners both key off these rows;
    // without them, every newly-added account is rejected with
    // "owners must have at least one entry". The relationship enum doesn't have
    // 'client'/'spouse' values, so we use 'other' as a placeholder — the role
    // column is what the UI keys off.
    const familyRows: Array<typeof familyMembers.$inferInsert> = [
      {
        clientId: client.id,
        role: "client",
        relationship: "other",
        firstName,
        lastName,
        dateOfBirth,
      },
    ];
    if (spouseName) {
      familyRows.push({
        clientId: client.id,
        role: "spouse",
        relationship: "other",
        firstName: spouseName,
        lastName: spouseLastName ?? lastName,
        dateOfBirth: spouseDob ?? null,
      });
    }
    await db.insert(familyMembers).values(familyRows);

    // Insert default household cash account. Household income lands here and expenses
    // are drawn from it; the projection engine pulls from the withdrawal strategy when
    // this balance would go negative.
    // Insert default household cash account. No account_owners rows are created here;
    // joint FM ownership is inferred when family members are added via the family page.
    await db.insert(accounts).values({
      clientId: client.id,
      scenarioId: scenario.id,
      name: "Household Cash",
      category: "cash",
      subType: "checking",
      value: "0",
      basis: "0",
      // null -> inherit the cash category default from plan_settings
      growthRate: null,
      rmdEnabled: false,
      isDefaultChecking: true,
    });

    // Seed two living-expense rows at $0 so the advisor has an obvious prompt to
    // fill in pre- and post-retirement spending. The retirement row is entered in
    // today's dollars so inflation compounds from plan start through retirement.
    const clientBirthYear = new Date(dateOfBirth).getFullYear();
    const retirementStartYear = clientBirthYear + Number(retirementAge);
    const planEndYearValue = clientBirthYear + Number(planEndAge);
    // Living expenses are anchored to milestones so they track changes to
    // retirement age and plan horizon: current-living runs plan_start →
    // client_retirement, retirement-living runs client_retirement → plan_end.
    const expenseSeeds = [
      {
        name: "Current Living Expenses",
        startYear: currentYear,
        startYearRef: "plan_start" as const,
        endYear: Math.max(currentYear, retirementStartYear),
        endYearRef: "client_retirement" as const,
        inflationStartYear: null as number | null,
      },
      {
        name: "Retirement Living Expenses",
        startYear: retirementStartYear,
        startYearRef: "client_retirement" as const,
        endYear: planEndYearValue,
        endYearRef: "plan_end" as const,
        inflationStartYear: currentYear,
      },
    ];
    await db.insert(expenses).values(
      expenseSeeds.map((seed) => ({
        clientId: client.id,
        scenarioId: scenario.id,
        type: "living" as const,
        name: seed.name,
        annualAmount: "0",
        startYear: seed.startYear,
        startYearRef: seed.startYearRef,
        endYear: seed.endYear,
        endYearRef: seed.endYearRef,
        growthRate: "0.03",
        inflationStartYear: seed.inflationStartYear,
        isDefault: true,
      }))
    );

    // Seed Social Security income entries at $0 — one per person on the household —
    // so the advisor is prompted to enter benefit amounts and claiming ages.
    const ssSeeds: { name: string; owner: "client" | "spouse" }[] = [
      { name: `Social Security — ${firstName}`, owner: "client" },
    ];
    if (spouseName) {
      ssSeeds.push({ name: `Social Security — ${spouseName}`, owner: "spouse" });
    }
    await db.insert(incomes).values(
      ssSeeds.map((seed) => ({
        clientId: client.id,
        scenarioId: scenario.id,
        type: "social_security" as const,
        name: seed.name,
        annualAmount: "0",
        startYear: currentYear,
        endYear: planEndYearValue,
        growthRate: "0.02",
        owner: seed.owner,
        claimingAge: 67,
      }))
    );

    await recordAudit({
      action: "client.create",
      resourceType: "client",
      resourceId: client.id,
      clientId: client.id,
      firmId,
      metadata: { firstName, lastName, crmHouseholdId },
    });

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

