"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  IntakeBrandingHeader,
  type IntakeHeaderBranding,
} from "@/components/intake/branding-header";
import { inputCls, labelCls } from "@/components/intake/steps/card-list";

interface IntakeVerifyGateProps {
  token: string;
  branding?: IntakeHeaderBranding | null;
}

/**
 * Identity challenge for the public intake link.
 *
 * Shown before any of the client's saved answers are rendered — the server
 * withholds the payload entirely until this passes, so this screen is the gate
 * itself, not a decoration over already-delivered data.
 */
export function IntakeVerifyGate({ token, branding }: IntakeVerifyGateProps) {
  const router = useRouter();
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/intake/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastName, email }),
      });

      if (res.ok) {
        // The gate cookie is set; re-render the server component so the form
        // (and only now, the saved payload) streams down.
        router.refresh();
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Unable to continue. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <IntakeBrandingHeader branding={branding} />

      <main id="main" className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Confirm it&rsquo;s you
            </p>
            <h1 className="mb-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">
              Before we continue<span className="text-accent">.</span>
            </h1>
            <p className="text-[15px] leading-[1.55] text-ink-2">
              This form holds personal financial details, so we check who you are
              before opening it.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="card rounded-[var(--radius-sm)] border border-hair bg-card p-6">
            <div className="mb-4">
              <label htmlFor="gate-lastName" className={labelCls}>
                Last name
              </label>
              <input
                id="gate-lastName"
                type="text"
                className={inputCls}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                autoFocus
                required
              />
            </div>

            <div className="mb-5">
              <label htmlFor="gate-email" className={labelCls}>
                Email address
              </label>
              <input
                id="gate-email"
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <p className="mt-1.5 text-[12px] leading-[1.4] text-ink-4">
                The address your advisor sent this link to.
              </p>
            </div>

            {error && (
              <p role="alert" className="mb-4 text-[13px] leading-[1.4] text-crit">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full rounded-[var(--radius-sm)] bg-accent px-8 py-3 text-[14px] font-medium text-accent-on transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>

          <p className="mt-6 text-center text-[12px] leading-[1.4] text-ink-4">
            Trouble getting in? Contact your advisor and they can send a fresh link.
          </p>
        </div>
      </main>
    </div>
  );
}
