import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients, scenarios, planSettings } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

// GET /api/clients — list all clients for the firm
export async function GET() {
  try {
    const firmId = await getOrgId();

    const rows = await db
      .select()
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
    const firmId = await getOrgId();
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      firstName,
      lastName,
      dateOfBirth,
      retirementAge,
      planEndAge,
      filingStatus,
      spouseName,
      spouseDob,
      spouseRetirementAge,
    } = body;

    if (!firstName || !lastName || !dateOfBirth || !retirementAge || !planEndAge || !filingStatus) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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
        planEndAge: Number(planEndAge),
        filingStatus,
        spouseName: spouseName ?? null,
        spouseDob: spouseDob ?? null,
        spouseRetirementAge: spouseRetirementAge ? Number(spouseRetirementAge) : null,
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
      planEndYear: currentYear + (Number(planEndAge) - new Date(dateOfBirth).getFullYear() - currentYear + new Date().getFullYear()),
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
