import { NextResponse, type NextRequest } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import {
  listClientActivity,
  type ActionKind,
  type DateRange,
} from "@/lib/activity/list-client-activity";
import { resolveActors } from "@/lib/activity/resolve-actors";

export const dynamic = "force-dynamic";

const VALID_KINDS: ActionKind[] = ["create", "update", "delete", "other"];
const VALID_RANGES: DateRange[] = ["7d", "30d", "90d", "all"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const [{ id: clientId }, firmId] = await Promise.all([params, requireOrgId()]);

  const url = new URL(req.url);
  const sp = url.searchParams;

  const actionKindRaw = sp.get("kind");
  const rangeRaw = sp.get("range");

  const filters = {
    actorId: sp.get("actor"),
    resourceType: sp.get("entity"),
    actionKind: VALID_KINDS.includes(actionKindRaw as ActionKind)
      ? (actionKindRaw as ActionKind)
      : null,
    range: (VALID_RANGES.includes(rangeRaw as DateRange)
      ? (rangeRaw as DateRange)
      : "90d") as DateRange,
  };

  const cursorCreatedAt = sp.get("cursorAt");
  const cursorId = sp.get("cursorId");
  const cursor =
    cursorCreatedAt && cursorId
      ? { createdAt: new Date(cursorCreatedAt), id: cursorId }
      : null;

  const { rows, nextCursor } = await listClientActivity({
    clientId,
    firmId,
    filters,
    cursor,
    limit: 50,
  });

  const actorMap = await resolveActors(rows.map((r) => r.actorId));

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      actor: actorMap.get(r.actorId) ?? { name: "Unknown", isSystem: false },
    })),
    nextCursor: nextCursor
      ? {
          createdAt: nextCursor.createdAt.toISOString(),
          id: nextCursor.id,
        }
      : null,
  });
}
