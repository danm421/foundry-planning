import type { ReactElement } from "react";
import type { IntakeBranding } from "@/lib/branding/branding";

/** The slice of resolved firm branding a mark renders (type-only import —
 *  the server-only resolver module is never bundled client-side). */
export type FirmMarkBranding = Pick<IntakeBranding, "logoUrl" | "firmName">;

/**
 * The firm's logo, wherever a client sees it: the portal chrome, the mobile
 * top bar and the intake/risk-questionnaire letterhead. Foundry Planning's own
 * lockup stands in when the firm hasn't uploaded one in Settings → Branding.
 * Plain <img>: logo URLs are public-blob unguessable hashes, not next/image
 * remote-pattern candidates.
 *
 * Only an uploaded logo gets the `letterhead` plate — see that token in
 * globals.css for why it needs its own ground. Our `lockup-horizontal.svg` is
 * already the dark-canvas cut of the mark, so a plate under it would be a
 * white patch on the surrounding chrome.
 *
 * One component rather than one per surface: the black-on-black defect the
 * plate fixes reached production on four surfaces at once precisely because
 * this logic was pasted per surface.
 */
export default function FirmMark({
  branding,
  className = "h-10 max-w-[240px]",
}: {
  branding: FirmMarkBranding | null;
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
