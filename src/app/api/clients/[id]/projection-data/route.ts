import { NextResponse } from "next/server";
import { loadClientData, ClientNotFoundError } from "@/lib/projection/load-client-data";
import { requireOrgId } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const firmId = await requireOrgId();
  try {
    const data = await loadClientData(id, firmId);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    throw err;
  }
}
