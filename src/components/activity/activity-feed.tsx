"use client";
import type { HydratedActivityRow } from "./activity-page";
import type { ActivityCursor, ActivityFilters } from "@/lib/activity/list-client-activity";
export default function ActivityFeed(_: {
  clientId: string;
  filters: ActivityFilters;
  initialRows: HydratedActivityRow[];
  initialNextCursor: ActivityCursor | null;
}) {
  return null;
}
