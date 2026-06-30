import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { checkProjectionRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";

export const dynamic = "force-dynamic";
// A cold 1000-trial run is ~75s of single-threaded CPU on the heaviest plans;
// pin the platform ceiling so a heavy household can't get killed at a lower
// default before the compute (and cache write) finishes.
export const maxDuration = 300;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const firmId = await requireOrgId();

  const access = await verifyClientAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const rl = await checkProjectionRateLimit(firmId);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many Monte Carlo requests. Please wait and try again.",
    );
  }

  const url = new URL(req.url);
  const scenarioId = url.searchParams.get("scenario") || "base";
  const forceRefresh = url.searchParams.get("refresh") === "1";

  try {
    const result = await getOrComputeMonteCarlo({
      clientId: id,
      firmId: access.firmId,
      scenarioId,
      forceRefresh,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    throw err;
  }
}
