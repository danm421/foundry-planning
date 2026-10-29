import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { suggestAttendees } from "@/lib/workspace/attendee-suggestions";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** Type-ahead attendee suggestions: visible CRM contacts, then firm teammates. */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();
    const query = new URL(req.url).searchParams.get("q") ?? "";
    const suggestions = await suggestAttendees({ firmId, userId, orgRole, query });
    return NextResponse.json({ suggestions });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
