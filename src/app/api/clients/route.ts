import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients, scenarios, planSettings, accounts, expenses, incomes } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { parseBody } from "@/lib/schemas/common";
import { clientCreateSchema } from "@/lib/schemas/resources";

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

// POST /api/clients — create a new client with base case scenario + plan settings
export async function POST(request: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseBody(clientCreateSchema, request);
    if (!parsed.ok) return parsed.response;
    const {
      firstName,
      lastName,
      dateOfBirth,
      retirementAge,
      lifeExpectancy,
      filingStatus,
      spouseName,
      spouseLastName,
      spouseDob,
      spouseRetirementAge,
      spouseLifeExpectancy,
    } = parsed.data;

    // Plan horizon is the year the last spouse dies; plan_end_age is derived
    // from client + spouse life expectancies.
    const planEndAge = computePlanEndAge({
      clientDob: dateOfBirth,
      clientLifeExpectancy: Number(lifeExpectancy),
      spouseDob: spouseDob ?? null,
      spouseLifeExpectancy: spouseLifeExpectancy != null ? Number(spouseLifeExpectancy) : null,
    });

    const currentYear = new Date().getFullYear();

    // Insert client
    const [client] = await db
      .insert(clients)
      .values({
        firmId,
        advisorId: userId,
        firstName,
        lastName,
        dateOfBirth,
        retirementAge: Number(retirementAge),
        planEndAge,
        lifeExpectancy: Number(lifeExpectancy),
        filingStatus,
        spouseName: spouseName ?? null,
        spouseLastName: spouseLastName ?? null,
        spouseDob: spouseDob ?? null,
        spouseRetirementAge: spouseRetirementAge ? Number(spouseRetirementAge) : null,
        spouseLifeExpectancy: spouseLifeExpectancy != null ? Number(spouseLifeExpectancy) : null,
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

    // Insert default household cash account. Household income lands here and expenses
    // are drawn from it; the projection engine pulls from the withdrawal strategy when
    // this balance would go negative.
    await db.insert(accounts).values({
      clientId: client.id,
      scenarioId: scenario.id,
      name: "Household Cash",
      category: "cash",
      subType: "checking",
      owner: "joint",
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

    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
