import type { Metadata } from "next";
import {
  loadQuestionnaireByToken,
  classifyToken,
  type TokenFailureReason,
} from "@/lib/risk/token-guard";
import { resolveIntakeBranding, type IntakeBranding } from "@/lib/branding/branding";
import { IntakeBrandingHeader } from "@/components/intake/branding-header";
import { IntakeThankYou } from "@/components/intake/thank-you";
import { RtqClient } from "./rtq-client";

// ─── Public risk questionnaire page ──────────────────────────────────────────
// Accessible at /risk-questionnaire/<token> — no auth required (proxy.ts
// allow-lists this path and its API sibling alongside the intake pair).
// Mirrors src/app/intake/[token]/page.tsx: firm-level branding resolved off
// the token's row, a branded failure state for every unusable-token reason,
// and no live advisor/client/plan data crossing into the public flow beyond
// the questionnaire itself.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const row = await loadQuestionnaireByToken(token);
  if (!row) return {};
  const branding = await resolveIntakeBranding(row.firmId);
  if (!branding) return {};
  return {
    title: `${branding.firmName} — Risk tolerance questionnaire`,
    ...(branding.faviconUrl ? { icons: { icon: branding.faviconUrl } } : {}),
  };
}

// ─── Unusable-link state ──────────────────────────────────────────────────────
// "already_submitted" is not handled here -- it reuses IntakeThankYou below,
// the same shared screen src/app/intake/[token]/page.tsx shows for a
// submitted/applied form, since the client has already completed this
// questionnaire and there's nothing more to say than "thank you" again.

type UnusableLinkReason = Exclude<TokenFailureReason, "already_submitted">;

const FAILURE_COPY: Record<UnusableLinkReason, { eyebrow: string; heading: string; body: string }> = {
  not_found: {
    eyebrow: "Link not found",
    heading: "This link isn't valid",
    body: "We couldn't find a questionnaire for this link. Please contact your advisor for a new one.",
  },
  expired: {
    eyebrow: "Link expired",
    heading: "This link is no longer active",
    body: "The invitation link has expired. Please contact your advisor to receive a new one.",
  },
};

function Unavailable({
  reason,
  branding,
}: {
  reason: UnusableLinkReason;
  branding: IntakeBranding | null;
}) {
  const copy = FAILURE_COPY[reason];
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <IntakeBrandingHeader branding={branding} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-md">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-3">
            {copy.eyebrow}
          </p>
          <h1 className="mb-4 text-3xl font-semibold tracking-tight text-ink">
            {copy.heading}
            <span className="text-accent">.</span>
          </h1>
          <p className="text-base leading-relaxed text-ink-2">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RiskQuestionnairePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const row = await loadQuestionnaireByToken(token);
  // Unknown token → no firm to brand for; a known row keeps its letterhead
  // even when expired/submitted so the client still sees who it belongs to.
  const branding = row ? await resolveIntakeBranding(row.firmId) : null;

  const verdict = classifyToken(row, new Date());
  if (!verdict.ok) {
    if (verdict.reason === "already_submitted") {
      // row is non-null whenever classifyToken returns "already_submitted".
      return <IntakeThankYou recipientName={row!.recipientName ?? null} branding={branding} />;
    }
    return <Unavailable reason={verdict.reason} branding={branding} />;
  }

  return <RtqClient token={token} recipientName={row!.recipientName ?? null} branding={branding} />;
}
