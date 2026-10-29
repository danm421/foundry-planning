import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import type { CalendarPaneState as PaneState } from "@/lib/workspace/types";

/** Every calendar pane that isn't the week itself. */
export type PaneView = Exclude<PaneState, "ready"> | "throttled";

// A plain anchor, never fetch(): the route answers with a redirect to Microsoft.
export const CONNECT_URL = "/api/workspace/microsoft/connect";
const SETTINGS_URL = "/settings/integrations/microsoft_365";
const INTRO = "Bring in your Outlook calendar";

export function CalendarPaneState({
  state,
  isAdmin,
  onRetry,
}: {
  state: PaneView;
  isAdmin: boolean;
  onRetry?: () => void;
}): ReactElement {
  switch (state) {
    case "firm_not_approved":
      return isAdmin ? (
        <Pane
          title={INTRO}
          body="Approve Microsoft 365 for your firm, then choose which advisors get it."
          action={
            <Link href={SETTINGS_URL} className="btn-primary text-sm">
              Connect Microsoft 365
            </Link>
          }
        />
      ) : (
        <Pane title={INTRO} body="Your firm's admin can turn on Microsoft 365 in Settings → Integrations." />
      );
    case "member_off":
      return <Pane title={INTRO} body="Ask your firm's admin to turn on Microsoft 365 for you." />;
    case "connect":
      return (
        <Pane
          title={INTRO}
          body="Your firm has approved Microsoft 365. Sign in once with your work account to see your week and your Outlook to-dos here."
          action={
            <a href={CONNECT_URL} className="btn-primary text-sm">
              Connect Microsoft 365
            </a>
          }
        />
      );
    case "needs_reconnect":
      return (
        <Pane
          title="Your Microsoft sign-in expired."
          body="Sign in again with your work account to see your week."
          action={
            <a href={CONNECT_URL} className="btn-primary text-sm">
              Reconnect
            </a>
          }
        />
      );
    case "throttled":
      return (
        <Pane
          title="Microsoft is busy right now — try again in a minute."
          action={
            <button type="button" className="btn-ghost text-sm" onClick={onRetry}>
              Retry
            </button>
          }
        />
      );
  }
}

function Pane({ title, body, action }: { title: string; body?: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center px-6 py-12 text-center">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {body ? <p className="mt-2 max-w-[44ch] text-sm leading-[1.55] text-ink-3">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
