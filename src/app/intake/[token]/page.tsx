import type { Metadata } from "next";
import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import {
  resolveIntakeBranding,
  type IntakeBranding,
} from "@/lib/branding/branding";
import { IntakeBrandingHeader } from "@/components/intake/branding-header";
import { IntakeThankYou } from "@/components/intake/thank-you";
import { IntakeClient } from "./intake-client";

// ─── Public intake page ──────────────────────────────────────────────────────
// Accessible at /intake/<token> — no auth required.
// Branches on form state; never passes live advisor/client plan data to the
// client wrapper (blank mode only passes the client's own saved draft).
// Every state carries the firm's letterhead (or the Foundry lockup when the
// firm hasn't uploaded a logo, or the token is unknown).

// ─── Tab chrome ───────────────────────────────────────────────────────────────
// loadFormByToken and resolveIntakeBranding are both React.cache'd, so metadata
// and the page render share one DB hit + one branding resolution per request.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const form = await loadFormByToken(token);
  if (!form) return {};
  const branding = await resolveIntakeBranding(form.firmId);
  if (!branding) return {};
  return {
    title: `${branding.firmName} — Client information form`,
    ...(branding.faviconUrl ? { icons: { icon: branding.faviconUrl } } : {}),
  };
}

// ─── Expired / missing link state ────────────────────────────────────────────

function ExpiredLink({ branding }: { branding: IntakeBranding | null }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <IntakeBrandingHeader branding={branding} />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-md">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-3">
            Link expired
          </p>
          <h1 className="mb-4 text-3xl font-semibold tracking-tight text-ink">
            This link is no longer active<span className="text-accent">.</span>
          </h1>
          <p className="text-base leading-relaxed text-ink-2">
            The invitation link has expired or is invalid. Please contact your
            advisor to receive a new one.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const form = await loadFormByToken(token);
  // Unknown token → no firm to brand for; known form keeps its letterhead even
  // when expired/submitted so the client still sees who the form belongs to.
  const branding = form ? await resolveIntakeBranding(form.firmId) : null;

  // Missing or expired token
  if (!form || isExpired(form, new Date())) {
    return <ExpiredLink branding={branding} />;
  }

  // Already submitted or applied — same shared screen the client wrapper shows
  // post-submit (no continueHref: the public flow has nowhere to send visitors).
  if (form.status === "submitted" || form.status === "applied") {
    return (
      <IntakeThankYou
        recipientName={form.recipientName ?? null}
        branding={branding}
      />
    );
  }

  // Active draft — hand off to the client wrapper.
  // Only pass what the client needs: token + their own saved draft payload.
  // NO live advisor/client/plan data crosses into the blank intake flow.
  return (
    <IntakeClient
      token={token}
      recipientName={form.recipientName ?? null}
      initialPayload={form.payload}
      branding={branding}
    />
  );
}
