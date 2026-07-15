"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
// `@clerk/nextjs`'s default `useSignIn` returns the newer signals-based API
// (`{ errors, fetchStatus, signIn: SignInFutureResource }`), which has no
// `create`/`setActive`. The classic `{ isLoaded, signIn, setActive }` shape
// this ticket-consumption flow needs still lives under the `/legacy` entry.
import { useSignIn } from "@clerk/nextjs/legacy";

/**
 * Headless Clerk sign-in-ticket consumer. Loaded in the mobile WebView at
 * `/intake/enter?ticket=…`. Runs clerk-js to establish a web cookie session
 * for the portal user, then redirects into the `/portal/intake` wizard.
 */
export function EnterClient({ ticket }: { ticket: string | null }): ReactElement {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { isSignedIn } = useAuth();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (!isLoaded || ran.current) return;
    ran.current = true;
    void (async () => {
      if (isSignedIn) {
        router.replace("/portal/intake");
        return;
      }
      if (!ticket) {
        setFailed(true);
        return;
      }
      try {
        const res = await signIn.create({ strategy: "ticket", ticket });
        if (res.status === "complete" && res.createdSessionId) {
          await setActive({ session: res.createdSessionId });
          router.replace("/portal/intake");
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      }
    })();
  }, [isLoaded, isSignedIn, ticket, signIn, setActive, router]);

  if (failed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-8 text-center">
        <div>
          <p className="text-[var(--color-ink)] font-semibold">This link expired</p>
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">
            Reopen intake from the app to try again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-hair)] border-t-[var(--color-accent)]"
        aria-label="Loading"
      />
    </main>
  );
}
