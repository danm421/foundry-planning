import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { searchClients } from "@/lib/client-search";

export async function GET(req: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const query = new URL(req.url).searchParams.get("q") ?? "";
  const results = await searchClients(query, userId, orgId);
  return NextResponse.json(results);
}
