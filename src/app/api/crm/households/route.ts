import { NextRequest, NextResponse } from "next/server";
import { listCrmHouseholds, createCrmHousehold } from "@/lib/crm/households";
import { createCrmHouseholdInteractiveSchema } from "@/lib/crm/schemas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const limit = Number(searchParams.get("limit") ?? 50);
    const offset = Number(searchParams.get("offset") ?? 0);
    const rows = await listCrmHouseholds({ search, status, limit, offset });
    return NextResponse.json({ households: rows });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/crm/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createCrmHouseholdInteractiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const created = await createCrmHousehold(parsed.data);
    return NextResponse.json({ household: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/crm/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
