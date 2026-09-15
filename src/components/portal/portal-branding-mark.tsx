import type { ReactElement } from "react";
import type { IntakeBranding } from "@/lib/branding/branding";

/** The slice of resolved firm branding the portal chrome renders (type-only
 *  import — the server-only resolver module is never bundled client-side). */
export type PortalBranding = Pick<IntakeBranding, "logoUrl" | "firmName">;

/**
 * Firm logo for the portal chrome; Foundry Planning lockup when the firm
 * hasn't uploaded one in Settings → Branding — same fallback pattern as the
 * intake letterhead. Plain <img>: logo URLs are public-blob unguessable
 * hashes, not next/image remote-pattern candidates.
 *
 * Only the firm logo gets the `letterhead` plate — see that token in
 * globals.css for why an uploaded logo needs its own ground. Our own
 * `lockup-horizontal.svg` is already the dark-canvas cut of the mark, so a
 * plate under it would be a white patch on the portal chrome.
 */
export default function PortalBrandingMark({
  branding,
  className = "h-10 max-w-[240px]",
}: {
  branding: PortalBranding | null;
  className?: string;
}): ReactElement {
  return branding ? (
    <span className="inline-flex items-center rounded-md bg-letterhead px-3 py-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={branding.logoUrl}
        alt={branding.firmName}
        className={`${className} object-contain`}
      />
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/lockup-horizontal.svg"
      alt="Foundry Planning"
      className={`${className} object-contain`}
    />
  );
}

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
  branding: PortalBranding | null;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`${className} sticky top-0 z-20 justify-center border-b border-hair bg-paper px-6 py-3 lg:px-10`}
    >
      <PortalBrandingMark branding={branding} />
    </div>
  );
}
