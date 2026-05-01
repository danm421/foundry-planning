"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status =
  | { kind: "polling" }
  | { kind: "ready"; firmName: string; buyerEmail: string }
  | { kind: "timeout" }
  | { kind: "error" };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 30;

export default function SuccessPolling({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "polling" });

  useEffect(() => {
    let attempt = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      attempt += 1;
      try {
        const res = await fetch(
          `/api/checkout/status?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) {
          if (res.status === 400 || res.status === 404) {
            setStatus({ kind: "error" });
            return;
          }
          // Transient — fall through and retry within the cap.
        } else {
          const data = (await res.json()) as
            | { ready: false }
            | { ready: true; firmName: string; buyerEmail: string };
          if (!cancelled && data.ready) {
            setStatus({
              kind: "ready",
              firmName: data.firmName,
              buyerEmail: data.buyerEmail,
            });
            return;
          }
        }
      } catch {
        /* network blip — retry within cap */
      }

      if (cancelled) return;
      if (attempt >= MAX_ATTEMPTS) {
        setStatus({ kind: "timeout" });
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  if (status.kind === "polling") {
    return (
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="mt-6 text-lg text-ink">Setting up your firm…</p>
        <p className="mt-2 text-sm text-ink-3">
          This usually takes a few seconds.
        </p>
      </div>
    );
  }

  if (status.kind === "ready") {
    return (
      <div className="text-center">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent">
          02 · Welcome aboard
        </p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink">
          Welcome to Foundry, {status.firmName}.
        </h1>
        <p className="mt-6 text-ink-2">
          We sent a sign-in invite to{" "}
          <span className="font-medium text-ink">{status.buyerEmail}</span>.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          Open the email, click <em>Accept invitation</em>, and you'll land in
          your workspace.
        </p>
        <p className="mt-8 text-xs text-ink-3">
          Didn't get the email after a few minutes? Email{" "}
          <a
            className="text-accent hover:underline"
            href="mailto:support@foundryplanning.com"
          >
            support@foundryplanning.com
          </a>
          .
        </p>
      </div>
    );
  }

  if (status.kind === "timeout") {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Provisioning is taking longer than expected.
        </h1>
        <p className="mt-4 text-ink-2">
          Your sign-in invite will arrive within a few minutes. If you don't
          see it, email{" "}
          <a
            className="text-accent hover:underline"
            href="mailto:support@foundryplanning.com"
          >
            support@foundryplanning.com
          </a>{" "}
          with your purchase email.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Something went wrong.
      </h1>
      <p className="mt-4 text-ink-2">
        We couldn't find your checkout session. If you completed a purchase,
        email{" "}
        <a
          className="text-accent hover:underline"
          href="mailto:support@foundryplanning.com"
        >
          support@foundryplanning.com
        </a>
        .
      </p>
      <p className="mt-6">
        <Link href="/pricing" className="text-sm text-accent hover:underline">
          Back to pricing
        </Link>
      </p>
    </div>
  );
}
