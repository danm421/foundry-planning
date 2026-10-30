import type { ReactElement, ReactNode } from "react";
import type { CalendarPaneState as PaneState } from "@/lib/workspace/types";

/**
 * Every calendar pane that isn't the week itself. `needs_reconnect` is a
 * write's 409; `unavailable` is any failure to read the week, which a retry
 * may not fix.
 */
export type PaneView = Exclude<PaneState, "ready"> | "needs_reconnect" | "unavailable";

// Plain anchors, never fetch(): the routes answer with a redirect to the provider.
export const MICROSOFT_CONNECT_URL = "/api/workspace/microsoft/connect";
export const GOOGLE_CONNECT_URL = "/api/workspace/google/connect";

export function CalendarPaneState({
  state,
  googleEnabled,
  onRetry,
}: {
  state: PaneView;
  /** Google's sign-in is set up on this deployment. */
  googleEnabled: boolean;
  onRetry?: () => void;
}): ReactElement {
  switch (state) {
    case "connect":
      return (
        <Pane
          title="Bring in your calendar and to-dos"
          body="Connect any of your addresses — Google or Microsoft 365. You can add more later."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {googleEnabled ? (
                <a href={GOOGLE_CONNECT_URL} className="btn-primary text-sm">
                  Connect Google
                </a>
              ) : null}
              <a href={MICROSOFT_CONNECT_URL} className="btn-primary text-sm">
                Connect Microsoft 365
              </a>
            </div>
          }
        />
      );
    case "impersonating":
      return (
        <Pane
          title="Hidden while you're signed in as someone else"
          body="Workspace never shows an advisor's Google or Microsoft calendar or to-dos to Foundry staff."
        />
      );
    case "needs_reconnect":
      return (
        <Pane
          title="Your sign-in expired."
          body="Sign in again to see your week."
          action={
            <a href={MICROSOFT_CONNECT_URL} className="btn-primary text-sm">
              Reconnect
            </a>
          }
        />
      );
    case "unavailable":
      return (
        <Pane
          title="Couldn't load your calendar."
          body="If this keeps happening, ask your firm's admin."
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
