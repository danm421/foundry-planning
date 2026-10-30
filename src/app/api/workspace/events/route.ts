import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { findHouseholdsByEmail, linkEventHousehold } from "@/lib/workspace/client-links";
import { listActingConnections } from "@/lib/workspace/acting-connection";
import { WorkspaceNotConnectedError } from "@/lib/workspace/errors";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { canEditEvent } from "@/lib/workspace/provider-adapter";
import { readWeek } from "@/lib/workspace/readers";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";

export const dynamic = "force-dynamic";

/** True for a real `YYYY-MM-DD` that falls on a Monday (weekday read in UTC, so server zone can't shift it). */
function isMonday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date) && d.getUTCDay() === 1;
}

/**
 * The signed-in advisor's week (Monday start) across every connected account,
 * in one display time zone, with household links. One account failing is that
 * account's `error` in `accounts`, never a failed week.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const start = new URL(req.url).searchParams.get("start");
    if (!start || !isMonday(start)) {
      return NextResponse.json({ error: "start must be a Monday (YYYY-MM-DD)" }, { status: 400 });
    }
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();

    const connections = await listActingConnections({ firmId, actorUserId: userId });
    if (connections.length === 0) throw new WorkspaceNotConnectedError("connect");
    const week = await readWeek({ connections, startDate: start, days: 7 });

    const links = await findHouseholdsByEmail({
      firmId,
      userId,
      orgRole,
      emails: week.events.flatMap((e) => e.attendees.map((a) => a.email)),
    });
    return NextResponse.json({
      timeZone: week.timeZone,
      timeZoneFallback: week.timeZoneFallback,
      accounts: week.accounts,
      events: week.events.map((e) => ({
        ...e,
        // Provider ids are unique per account only.
        key: `${e.connectionId}:${e.id}`,
        editable: canEditEvent(e),
        household: linkEventHousehold(e, links),
      })),
    });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
