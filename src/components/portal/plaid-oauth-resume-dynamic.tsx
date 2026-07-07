"use client";

import dynamic from "next/dynamic";
import { OAuthResumeSpinner } from "./plaid-oauth-resume-spinner";

// react-plaid-link touches `window`, so the resume view must not SSR (mirrors
// plaid-link-button-dynamic). The fallback is the same spinner the mounted view
// shows while resuming, so there's no flash before the chunk arrives.
export const PlaidOAuthResume = dynamic(
  () =>
    import("@/components/portal/plaid-oauth-resume").then(
      (m) => m.PlaidOAuthResume,
    ),
  {
    ssr: false,
    loading: () => <OAuthResumeSpinner />,
  },
);
