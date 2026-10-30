import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordAudit } from "@/lib/audit";
import { requireActiveSubscription } from "@/lib/authz";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { findHouseholdsByEmail, linkEventHousehold } from "@/lib/workspace/client-links";
import { resolveActingConnection } from "@/lib/workspace/acting-connection";
import { isWorkspaceEnabled } from "@/lib/workspace/flag";
import { createEvent, getMailboxTimeZone, listEvents } from "@/lib/workspace/microsoft/calendar";
import { canEditEvent } from "@/lib/workspace/provider-adapter";
import type { GraphContext } from "@/lib/workspace/microsoft/graph";
import { workspaceErrorResponse } from "@/lib/workspace/route-errors";
import { createEventSchema } from "@/lib/workspace/schemas";

export const dynamic = "force-dynamic";

/** True for a real `YYYY-MM-DD` that falls on a Monday (weekday read in UTC, so server zone can't shift it). */
function isMonday(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date) && d.getUTCDay() === 1;
}

/** The signed-in advisor's Outlook week (Monday start) with household links. */
export async function GET(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    const start = new URL(req.url).searchParams.get("start");
    if (!start || !isMonday(start)) {
      return NextResponse.json({ error: "start must be a Monday (YYYY-MM-DD)" }, { status: 400 });
    }
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { orgRole } = await auth();

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, provider: "microsoft" });
    const ctx: GraphContext = { conn };
    const timeZone = await getMailboxTimeZone(ctx);
    const events = await listEvents(ctx, { startDate: start, days: 7, timeZone });

    const links = await findHouseholdsByEmail({
      firmId,
      userId,
      orgRole,
      emails: events.flatMap((e) => e.attendees.map((a) => a.email)),
    });
    return NextResponse.json({
      timeZone,
      events: events.map((e) => ({ ...e, editable: canEditEvent(e), household: linkEventHousehold(e, links) })),
    });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}

/** Creates an event on the advisor's own calendar, optionally with a Teams meeting. */
export async function POST(req: Request): Promise<Response> {
  if (!isWorkspaceEnabled()) return new Response("Not found", { status: 404 });
  try {
    await requireActiveSubscription();
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const parsed = await parseBody(createEventSchema, req);
    if (!parsed.ok) return parsed.response;

    const conn = await resolveActingConnection({ firmId, actorUserId: userId, provider: "microsoft" });
    const ctx: GraphContext = { conn };
    const timeZone = await getMailboxTimeZone(ctx);
    const { event, videoFailed } = await createEvent(ctx, { ...parsed.data, timeZone });

    await recordAudit({
      action: "workspace.event_create",
      resourceType: "workspace_event",
      resourceId: event.id,
      firmId,
      metadata: { eventId: event.id },
    });
    return NextResponse.json({ event, teamsFailed: videoFailed }, { status: 201 });
  } catch (err) {
    return workspaceErrorResponse(err);
  }
}
