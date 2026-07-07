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
      <span className="inline-block h-9 w-28 animate-pulse rounded-md bg-hair" aria-hidden />
    ),
  },
);
