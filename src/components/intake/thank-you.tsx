import Link from "next/link";
import {
  IntakeBrandingHeader,
  type IntakeHeaderBranding,
} from "./branding-header";

/**
 * Post-submit thank-you screen shared by the public (token) and portal intake
 * wrappers. Pass `continueHref` to show a "Continue to your portal" CTA (portal
 * flow); omit it for the public flow, which has nowhere to send the visitor.
 */
export function IntakeThankYou({
  recipientName,
  continueHref,
  branding,
}: {
  recipientName: string | null;
  continueHref?: string;
  branding?: IntakeHeaderBranding | null;
}) {
  const greeting = recipientName ? `Thank you, ${recipientName}` : "Thank you";
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <IntakeBrandingHeader branding={branding} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-md">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-3">
            Submitted
          </p>
          <h1 className="mb-4 text-3xl font-semibold tracking-tight text-ink">
            {greeting}
            <span className="text-accent">.</span>
          </h1>
          <p
            className={`${continueHref ? "mb-6 " : ""}text-base leading-relaxed text-ink-2`}
          >
            We&rsquo;ve received your information. Your advisor will be in touch
            soon.
          </p>
          {continueHref && (
            <Link
              href={continueHref}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Continue to your portal
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
