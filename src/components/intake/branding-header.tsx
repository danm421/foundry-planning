import FirmMark, { type FirmMarkBranding } from "@/components/firm-mark";

/** What the letterhead calls the firm-branding slice it renders. */
export type IntakeHeaderBranding = FirmMarkBranding;

/**
 * Letterhead shown at the top of every client-facing intake state (welcome,
 * wizard steps, thank-you, expired) and of the risk questionnaire — the
 * client's first sight of the firm. The mark brings its own ground; see
 * `FirmMark`.
 */
export function IntakeBrandingHeader({
  branding,
}: {
  branding?: IntakeHeaderBranding | null;
}) {
  return (
    <header className="flex justify-center px-4 pt-8">
      <FirmMark branding={branding} />
    </header>
  );
}
