import type { ReactElement } from "react";
import FirmMark, { type FirmMarkBranding } from "@/components/firm-mark";

/**
 * The portal's desktop letterhead: one bar across the top of the window with
 * the firm's mark at the left and the household greeting on the same line
 * beside it. It sits ABOVE the nav rail and the content column rather than
 * inside either, so the mark and the greeting can never drift out of line with
 * each other.
 *
 * `className` carries visibility overrides — the client portal layout passes
 * `"hidden lg:flex"` (mobile gets the mark and its own greeting inside the top
 * tab bar instead); the advisor preview renders it unconditionally.
 */
export function PortalBrandingStrip({
  branding,
  displayName = "",
  className = "flex",
}: {
  branding: FirmMarkBranding | null;
  /**
   * Who the bar greets — both halves of the household by first and last name
   * ("John Cooper & Jane Cooper"), from `portalGreetingFullName`. Empty renders
   * a nameless "Welcome back".
   */
  displayName?: string;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`${className} shrink-0 items-center gap-4 border-b border-hair bg-paper px-5 py-3`}
    >
      <FirmMark branding={branding} />
      {/* Hairline, not a gap alone: the mark carries its own letterhead plate,
          and the rule keeps that block from reading as part of the sentence. */}
      <span aria-hidden className="h-6 w-px shrink-0 bg-hair" />
      {/* The one place in the portal that addresses the client as a person, so
          the names carry the weight and "Welcome back," stays quiet. */}
      <span className="truncate text-[15px] text-ink-3">
        Welcome back
        {displayName && (
          <>
            , <span className="font-semibold text-ink">{displayName}</span>
          </>
        )}
      </span>
    </div>
  );
}
