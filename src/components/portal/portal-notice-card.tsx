import type { ReactElement, ReactNode } from "react";

/**
 * The card a portal section renders in place of its content — icon, heading and
 * one explanatory line. Shared by `NotSharedNotice` (the client hid this from
 * their advisor) and `PortalFeatureOffNotice` (the advisor switched the section
 * off): different audiences and different copy, but one shell, so the two can't
 * drift into two slightly different cards.
 *
 * `variant="page"` fills a section route; `variant="tile"` sits in the
 * dashboard grid where a data tile would.
 */
export function PortalNoticeCard({
  icon,
  heading,
  children,
  variant = "page",
}: {
  icon: ReactNode;
  heading: string;
  children: ReactNode;
  variant?: "page" | "tile";
}): ReactElement {
  const body = (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-ink-4">{icon}</span>
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold text-ink">{heading}</h2>
        <p className="text-[13px] leading-relaxed text-ink-3">{children}</p>
      </div>
    </div>
  );
  if (variant === "tile") {
    return <section className="rounded-xl border border-hair bg-card p-5">{body}</section>;
  }
  return (
    <div className="p-6 lg:p-10">
      <div className="max-w-md rounded-xl border border-hair bg-card p-6">{body}</div>
    </div>
  );
}
