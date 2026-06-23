import { loadFormByToken } from "@/lib/intake/queries";
import { isExpired } from "@/lib/intake/tokens";
import { IntakeClient } from "./intake-client";

// ─── Public intake page ──────────────────────────────────────────────────────
// Accessible at /intake/<token> — no auth required.
// Branches on form state; never passes live advisor/client plan data to the
// client wrapper (blank mode only passes the client's own saved draft).

// ─── Expired / missing link state ────────────────────────────────────────────

function ExpiredLink() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16 text-center">
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
  );
}

// ─── Already-submitted state ──────────────────────────────────────────────────

function ThankYou({ recipientName }: { recipientName: string | null }) {
  const greeting = recipientName ? `Thank you, ${recipientName}` : "Thank you";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16 text-center">
      <div className="max-w-md">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-3">
          Submitted
        </p>
        <h1 className="mb-4 text-3xl font-semibold tracking-tight text-ink">
          {greeting}<span className="text-accent">.</span>
        </h1>
        <p className="text-base leading-relaxed text-ink-2">
          We&rsquo;ve received your information. Your advisor will be in touch
          soon.
        </p>
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

  // Missing or expired token
  if (!form || isExpired(form, new Date())) {
    return <ExpiredLink />;
  }

  // Already submitted or applied
  if (form.status === "submitted" || form.status === "applied") {
    return <ThankYou recipientName={form.recipientName ?? null} />;
  }

  // Active draft — hand off to the client wrapper.
  // Only pass what the client needs: token + their own saved draft payload.
  // NO live advisor/client/plan data crosses into the blank intake flow.
  return (
    <IntakeClient
      token={token}
      recipientName={form.recipientName ?? null}
      initialPayload={form.payload}
    />
  );
}
