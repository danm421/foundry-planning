import { NextResponse } from "next/server";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { requireOrgId } from "@/lib/db-helpers";
import { checkProjectionRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const firmId = await requireOrgId();

  const rl = await checkProjectionRateLimit(firmId);
  if (!rl.allowed) {
    const headers: Record<string, string> = {};
    if (rl.reset) {
      headers["Retry-After"] = String(
        Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
      );
    }
    return NextResponse.json(
      { error: "Too many projection requests. Please wait and try again." },
      { status: rl.reason === "exceeded" ? 429 : 503, headers },
    );
  }

  const url = new URL(req.url);
  const scenarioParam = url.searchParams.get("scenario");
  try {
    const { effectiveTree } = await loadEffectiveTree(
      id,
      firmId,
      scenarioParam ?? "base",
      {},
    );
    return NextResponse.json(effectiveTree);
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    throw err;
  }
}
