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
 */
export default function PortalBrandingMark({
  branding,
  className = "h-7 max-w-[200px]",
}: {
  branding: PortalBranding | null;
  className?: string;
}): ReactElement {
  return branding ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={branding.logoUrl}
      alt={branding.firmName}
      className={`${className} object-contain`}
    />
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
 * Sticky right-aligned strip hosting the mark at the top of the portal's
 * main column. `className` carries visibility overrides — the client portal
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
      className={`${className} sticky top-0 z-20 justify-end border-b border-hair bg-paper px-6 py-2.5 lg:px-10`}
    >
      <PortalBrandingMark branding={branding} />
    </div>
  );
}
