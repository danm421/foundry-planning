"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { LANDING_PATH } from "@/lib/routes";

type Status =
  | { kind: "polling" }
  | { kind: "ready"; firmName: string; buyerEmail: string; firmId?: string }
  | { kind: "entering" }
  | { kind: "activation_failed" }
  | { kind: "timeout" }
  | { kind: "error" };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 30;
// Clerk's setActive() rejects on a network failure, which the catch below turns
// into a real way in — but a request that neither resolves nor rejects would
// leave the buyer on "Opening your workspace…" for good. Cap it.
const ACTIVATION_TIMEOUT_MS = 15000;

const SUPPORT_EMAIL = "support@foundryplanning.com";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

export default function SuccessPolling({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "polling" });
  // Bumped by "Check again" on the timeout screen. Re-running the poller is the
  // ONLY onward route we give a self-serve buyer there: they have already paid,
  // and every other way off this page walks them back into a second Checkout.
  const [pollCycle, setPollCycle] = useState(0);

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
            | { ready: true; firmName: string; buyerEmail: string; firmId?: string };
          if (!cancelled && data.ready) {
            setStatus({
              kind: "ready",
              firmName: data.firmName,
              buyerEmail: data.buyerEmail,
              firmId: data.firmId,
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
  }, [sessionId, pollCycle]);

  // The self-serve buyer made their account BEFORE paying, so they are signed
  // in and still org-less while their firm is being provisioned. The sales-path
  // buyer has no account at all yet — an invitation email is what makes them
  // one — which is why the two get different copy below.
  const { isSignedIn, orgId } = useAuth();
  const isSelfServeBuyer = !!isSignedIn && !orgId;

  const { setActive } = useOrganizationList();
  const router = useRouter();
  const activated = useRef(false);

  // A firmId comes back only when the poller IS the buyer, and only once the
  // org's billing status is stamped (see /api/checkout/status). So by the time
  // we get here the org is safe to activate: setActive mints a fresh session
  // token that already carries org_public_metadata, and proxy.ts sees a
  // `trialing` firm rather than the `missing` state it blocks outright.
  //
  // This is what replaces the invitation email.
  //
  // NOTE: this effect's deps include `status`, which it also sets — a naive
  // cancel-on-cleanup would tear down run #1 the instant `entering` is set
  // and never fire router.push. Guard with a ref instead of a cleanup flag.
  useEffect(() => {
    if (status.kind !== "ready" || !status.firmId || !setActive) return;
    if (activated.current) return;
    activated.current = true;
    const orgId = status.firmId;
    void (async () => {
      setStatus({ kind: "entering" });
      try {
        await withTimeout(setActive({ organization: orgId }), ACTIVATION_TIMEOUT_MS);
        router.push(LANDING_PATH);
      } catch (err) {
        console.error("[checkout-success] setActive failed:", err);
        setStatus({ kind: "activation_failed" });
      }
    })();
  }, [status, setActive, router]);

  // A ready-with-firmId state is momentary: the activation effect below
  // flips it to "entering" on its very next run, but effects fire after
  // paint, and this update originates from a fetch resolution (not a
  // discrete event), so React can paint "ready" first. Folding the
  // condition in here — rather than only branching on "entering" — makes
  // that one-frame flash of the invitation copy structurally impossible:
  // a ready-with-firmId state can no longer reach the invite JSX at all.
  // (Not covered by a test: jsdom doesn't paint, so no test in this file
  // can observe a pre-paint frame either way — this structural fix is the
  // stronger guarantee.)
  if (status.kind === "entering" || (status.kind === "ready" && status.firmId)) {
    return (
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <p className="mt-6 text-lg text-ink">Opening your workspace…</p>
      </div>
    );
  }

  if (status.kind === "activation_failed") {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Your firm is ready<span className="dot">.</span>
        </h1>
        <p className="mt-4 text-ink-2">
          We couldn&rsquo;t open it automatically — one click and you&rsquo;re in.
        </p>
        <a href={LANDING_PATH} className="btn-primary mt-7">
          Continue to your workspace
        </a>
      </div>
    );
  }

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
          Open the email, click <em>Accept invitation</em>, and you&rsquo;ll land in
          your workspace.
        </p>
        <p className="mt-8 text-xs text-ink-3">
          Didn&rsquo;t get the email after a few minutes? Email{" "}
          <a
            className="text-accent underline underline-offset-4 hover:text-accent-ink"
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
    // A self-serve buyer gets NO invitation email — removing it is the whole
    // point of this flow — so promising one here would send them to an inbox
    // that never fills. Worse, they are signed in and org-less, so every route
    // off this page runs through /select-organization to /welcome and into a
    // SECOND Checkout: a second firm and a second subscription for someone who
    // has already paid. The only affordance we give them is another look.
    if (isSelfServeBuyer) {
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Still setting up your firm<span className="dot">.</span>
          </h1>
          <p className="mt-4 text-ink-2">
            Your payment went through — there is nothing to pay again. Setup is
            taking longer than usual, and your workspace opens by itself the
            moment it is ready.
          </p>
          <button
            type="button"
            onClick={() => {
              setStatus({ kind: "polling" });
              setPollCycle((cycle) => cycle + 1);
            }}
            className="btn-primary mt-7"
          >
            Check again
          </button>
          <p className="mt-8 text-xs text-ink-3">
            Still nothing after a few minutes? Email{" "}
            <a className="text-accent underline underline-offset-4 hover:text-accent-ink" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>{" "}
            and we will finish it for you.
          </p>
        </div>
      );
    }

    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Provisioning is taking longer than expected.
        </h1>
        <p className="mt-4 text-ink-2">
          Your sign-in invite will arrive within a few minutes. If you don&rsquo;t
          see it, email{" "}
          <a className="text-accent underline underline-offset-4 hover:text-accent-ink" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
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
        We couldn&rsquo;t find your checkout session. If you completed a purchase,
        email{" "}
        <a
          className="text-accent underline underline-offset-4 hover:text-accent-ink"
          href="mailto:support@foundryplanning.com"
        >
          support@foundryplanning.com
        </a>
        .
      </p>
      <p className="mt-6">
        <a
          href="https://foundryplanning.com/pricing"
          className="text-sm text-accent hover:underline"
        >
          Back to pricing
        </a>
      </p>
    </div>
  );
}
