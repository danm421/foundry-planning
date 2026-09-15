import FirmMark, { type FirmMarkBranding } from "@/components/firm-mark";

/** What the letterhead calls the firm-branding slice it renders. */
export type IntakeHeaderBranding = FirmMarkBranding;

/**
 * Letterhead shown at the top of every client-facing intake state (welcome,
 * wizard steps, thank-you, expired) and of the risk questionnaire. This is the
 * client's first sight of the firm, and it sits on `paper` — dark under the
 * default theme — so the mark brings its own letterhead plate; see `FirmMark`.
 */
export function IntakeBrandingHeader({
  branding,
}: {
  branding?: IntakeHeaderBranding | null;
}) {
  return (
    <header className="flex justify-center px-4 pt-8">
      <FirmMark branding={branding ?? null} />
    </header>
  );
}
