"use client";

import dynamic from "next/dynamic";

// Defers react-plaid-link (~373KB) off the portal's first paint until a Plaid
// button actually renders. usePlaidLink touches `window`, so `ssr: false`. The
// loading fallback reserves the button's footprint to avoid a layout shift when
// the chunk arrives. The `LinkSuccessPayload` type lives in
// "@/lib/portal/plaid-link-complete" (type-only imports carry no runtime weight).
export const PlaidLinkButton = dynamic(
  () => import("@/components/portal/plaid-link-button").then((m) => m.PlaidLinkButton),
  {
    ssr: false,
    loading: () => (
      <span className="inline-block h-9 w-32 animate-pulse rounded-md bg-hair" aria-hidden />
    ),
  },
);

/**
 * The same component for `trigger="auto"`, which draws no button — so the
 * loading state has to reserve nothing. Sharing `PlaidLinkButton`'s fallback
 * would flash a button-shaped placeholder where no button belongs.
 */
export const PlaidLinkAuto = dynamic(
  () => import("@/components/portal/plaid-link-button").then((m) => m.PlaidLinkButton),
  { ssr: false, loading: () => null },
);
