export interface IntakeHeaderBranding {
  logoUrl: string;
  firmName: string;
}

/**
 * Letterhead shown at the top of every client-facing intake state (welcome,
 * wizard steps, thank-you, expired). Firm logo when the firm uploaded one in
 * Settings → Branding; Foundry Planning lockup otherwise — same fallback
 * pattern as the (auth) layout. Plain <img>: logo URLs are public-blob
 * unguessable hashes, not next/image remote-pattern candidates.
 */
export function IntakeBrandingHeader({
  branding,
}: {
  branding?: IntakeHeaderBranding | null;
}) {
  return (
    <header className="flex justify-center px-4 pt-8">
      {branding ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt={branding.firmName}
          className="h-10 max-w-[240px] object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/lockup-horizontal.svg"
          alt="Foundry Planning"
          className="h-7 w-auto"
        />
      )}
    </header>
  );
}
