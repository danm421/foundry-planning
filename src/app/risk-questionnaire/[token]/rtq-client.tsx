"use client";

import { useState } from "react";
import { RtqForm } from "@/components/risk/rtq-form";
import { RTQ_V1, type RtqAnswers } from "@/lib/risk/rtq";
import { IntakeBrandingHeader } from "@/components/intake/branding-header";
import { IntakeThankYou } from "@/components/intake/thank-you";
import type { IntakeBranding } from "@/lib/branding/branding";

interface RtqClientProps {
  token: string;
  /** The token row's recipientName, if the advisor supplied one when sending
   *  the link -- greets the client by name on the post-submit screen, same as
   *  the intake flow's IntakeClient. */
  recipientName: string | null;
  /** Firm letterhead; null renders the Foundry Planning lockup. */
  branding: IntakeBranding | null;
}

/**
 * Client wrapper for the public questionnaire: owns the POST + the
 * submitted/error state, under the firm's letterhead. RtqForm itself stays
 * fetch-free (also used by the advisor-administered RtqDialog), so this is
 * the only place that knows the public route's URL and status codes.
 */
export function RtqClient({ token, recipientName, branding }: RtqClientProps) {
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(answers: RtqAnswers, environmentNote: string | undefined) {
    const res = await fetch(`/api/risk-questionnaire/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, environmentNote }),
    });

    if (res.ok) {
      setSubmitted(true);
      return;
    }

    if (res.status === 409) {
      // Already applied -- most likely a double submit; show the same
      // thank-you rather than an error.
      setSubmitted(true);
      return;
    }

    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 410) {
      throw new Error("This link has expired. Please contact your advisor for a new one.");
    }
    if (res.status === 403) {
      throw new Error("This advisor's account is not currently active. Please contact them directly.");
    }
    throw new Error(body?.error ?? "Failed to submit.");
  }

  if (submitted) {
    return <IntakeThankYou recipientName={recipientName} branding={branding} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <IntakeBrandingHeader branding={branding} />
      <div className="mx-auto w-full max-w-xl px-6 py-12">
        <div className="mb-6">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-ink-3">
            Risk tolerance questionnaire
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            A few questions about how you invest<span className="text-accent">.</span>
          </h1>
        </div>
        <RtqForm questions={RTQ_V1} onSubmit={handleSubmit} showEnvironmentNote />
      </div>
    </div>
  );
}
