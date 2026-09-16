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
 * Every mark carries its own ground: `lockup-horizontal.svg` bakes a dark one
 * into the SVG, so it is drawn bare; an uploaded logo is print ink and gets
 * the `letterhead` plate. That token in globals.css is where the rule lives.
 *
 * One component rather than one per surface: the black-on-black defect the
 * plate fixes reached production on four surfaces at once precisely because
 * this logic was pasted per surface.
 */
export default function FirmMark({
  branding,
  className = "h-10 max-w-[240px]",
}: {
  branding?: FirmMarkBranding | null;
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
