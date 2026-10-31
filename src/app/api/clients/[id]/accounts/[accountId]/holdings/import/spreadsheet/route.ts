import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { readGrid } from "@/lib/crm/import/read-file";
import { readHoldingsGrid, type SpreadsheetRead } from "@/lib/investments/holdings-import";
import { holdingsImportGate } from "../gate";

export const dynamic = "force-dynamic";

// A holdings sheet is a few hundred rows at most; Vercel refuses a request
// body past 4.5 MB before the route runs anyway.
const MAX_SPREADSHEET_BYTES = 4 * 1024 * 1024;

/**
 * Read positions off an uploaded .xlsx or .csv by its column headers — no AI.
 * Writes nothing: the advisor reviews what was read, then the import route
 * saves it.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id: clientId, accountId } = await params;
    if (!(await holdingsImportGate(clientId, accountId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a spreadsheet to upload." }, { status: 400 });
    }
    if (file.size > MAX_SPREADSHEET_BYTES) {
      return NextResponse.json({ error: "That file is too large for a holdings sheet (4 MB max)." }, { status: 413 });
    }

    let grid: (string | number)[][];
    try {
      grid = await readGrid(Buffer.from(await file.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: "Couldn't open that file. Upload an .xlsx or .csv." }, { status: 400 });
    }

    const result = readHoldingsGrid(grid);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ holdings: result.holdings, warnings: result.warnings } satisfies SpreadsheetRead);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings/import/spreadsheet error:", err);
    return NextResponse.json({ error: "Couldn't read that spreadsheet." }, { status: 500 });
  }
}
