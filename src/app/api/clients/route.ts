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
import { eq, and, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { parseBody } from "@/lib/schemas/common";
import { clientCreateSchema } from "@/lib/schemas/resources";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/clients — list all clients for the firm
export async function GET() {
  try {
    const firmId = await requireOrgId();

    // Tight projection: the list UI only needs identity + the fields
     // shown in the table. Full DOB, spouse DOB, filing status, and the
     // internal advisorId Clerk user reference are held back.
    const rows = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        spouseName: clients.spouseName,
        spouseLastName: clients.spouseLastName,
        retirementAge: clients.retirementAge,
        planEndAge: clients.planEndAge,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(eq(clients.firmId, firmId))
      .orderBy(asc(clients.lastName), asc(clients.firstName));

    return NextResponse.json(rows);
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
    const email = primary.email ?? null;
    const address = formatAddress(primary);
    const spouseName = spouse?.firstName ?? null;
    const spouseLastName = spouse?.lastName ?? null;
    const spouseDob = spouse?.dateOfBirth ?? null;
    const spouseEmail = spouse?.email ?? null;
    const spouseAddress = spouse ? formatAddress(spouse) : null;

    // Plan horizon is the year the last spouse dies; plan_end_age is derived
    // from client + spouse life expectancies.
    const planEndAge = computePlanEndAge({
      clientDob: dateOfBirth,
      clientLifeExpectancy: Number(lifeExpectancy),
      spouseDob: spouseDob ?? null,
      spouseLifeExpectancy: spouseLifeExpectancy != null ? Number(spouseLifeExpectancy) : null,
    });

    const currentYear = new Date().getFullYear();

    // Insert client — dual-writes legacy identity columns from the CRM contacts.
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: userId,
        crmHouseholdId,
        firstName,
        lastName,
        dateOfBirth,
        retirementAge: Number(retirementAge),
        retirementMonth: retirementMonth != null ? Number(retirementMonth) : 1,
        planEndAge,
        lifeExpectancy: Number(lifeExpectancy),
        filingStatus,
        spouseName,
        spouseLastName,
        spouseDob,
        spouseRetirementAge: spouseRetirementAge ? Number(spouseRetirementAge) : null,
        spouseRetirementMonth: spouseRetirementMonth != null ? Number(spouseRetirementMonth) : null,
        spouseLifeExpectancy: spouseLifeExpectancy != null ? Number(spouseLifeExpectancy) : null,
        email,
        address,
        spouseEmail,
        spouseAddress,
      })
      .returning();

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

    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Flatten a CRM contact's structured address into the single-line legacy
// `address` column the planning UI still expects. Phase 9 drops this column.
function formatAddress(contact: typeof crmHouseholdContacts.$inferSelect): string | null {
  const parts = [
    contact.addressLine1,
    contact.addressLine2,
    [contact.city, contact.state].filter(Boolean).join(", "),
    contact.postalCode,
  ].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return null;
  return parts.join("\n");
}
