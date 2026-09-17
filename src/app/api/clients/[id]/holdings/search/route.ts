import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/db-helpers";
import { securitySearchSchema } from "@/lib/schemas/holdings";
import { searchSecurities } from "@/lib/investments/classification/search-securities";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/holdings/search?q= — free-text security lookup for the
 * holdings ticker picker: matches on a security's NAME as well as its symbol,
 * for a statement that gives one and not the other.
 *
 * Client-scoped, not account-scoped like its `quote`/`classify` siblings: the
 * answer is public reference data and depends on nothing about the account, so
 * an account id would only buy a DB round trip per keystroke for a check no
 * part of the handler uses. Reads nothing and writes nothing — view access is
 * enough, the same bar `quote` sets.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!(await verifyClientAccess(id)).ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const parsed = securitySearchSchema.safeParse({
      q: req.nextUrl.searchParams.get("q") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Type at least two characters." }, { status: 400 });
    }
    return NextResponse.json({ results: await searchSecurities(parsed.data.q) });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Deliberately NOT fail-soft: this runs on a click, and an empty list would
    // read as "no such security" when the truth is that the feed is down.
    console.error("GET security search error:", err);
    return NextResponse.json(
      { error: "Security search is unavailable right now." },
      { status: 503 },
    );
  }
}
