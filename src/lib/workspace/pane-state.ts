// src/lib/workspace/pane-state.ts
import type { CalendarPaneState } from "./types";

/** An impersonation session sees none of the advisor's accounts, however many they hold. */
export function calendarPaneState(input: { impersonating: boolean; accountCount: number }): CalendarPaneState {
  if (input.impersonating) return "impersonating";
  return input.accountCount === 0 ? "connect" : "ready";
}
