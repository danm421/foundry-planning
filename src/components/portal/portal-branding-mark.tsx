import type { ReactElement } from "react";
import FirmMark, { type FirmMarkBranding } from "@/components/firm-mark";


/**
 * Sticky centered strip hosting the mark at the top of the portal's main
 * column — the firm's letterhead sits between the nav rail's welcome line and
 * the detail rail. `className` carries visibility overrides — the client portal
 * layout passes `"hidden lg:flex"` (mobile gets the mark inside its top bar
 * instead); the advisor preview renders it unconditionally.
 */
export function PortalBrandingStrip({
  branding,
  className = "flex",
}: {
  branding: FirmMarkBranding | null;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`${className} sticky top-0 z-20 justify-center border-b border-hair bg-paper px-6 py-3 lg:px-10`}
    >
      <FirmMark branding={branding} />
    </div>
  );
}
