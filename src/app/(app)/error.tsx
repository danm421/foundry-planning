"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for authenticated pages under the (app) route group (audit F17).
 *
 * Before this existed, an error thrown in a page rendered Next's raw unbranded
 * error screen AND bypassed Sentry (only global-error.tsx — root-layout only —
 * called captureException). This boundary reports to Sentry and offers a branded
 * recovery path. global-error.tsx still backstops layout-level failures.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium text-ink-3">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">
          This page hit an unexpected error
        </h1>
        <p className="mt-3 text-sm text-ink-2">
          The error has been reported and we&rsquo;ll take a look. You can try
          again, or head back to safety.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-ink-3">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-hair px-4 py-2 text-sm text-ink-2 hover:bg-card-2"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
