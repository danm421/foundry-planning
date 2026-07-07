"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { PlaidAccountPicker } from "./plaid-account-picker";
import { OAuthResumeSpinner } from "./plaid-oauth-resume-spinner";
import {
  runPlaidLinkSuccess,
  getPlaidOAuthCtx,
  clearPlaidOAuthCtx,
  type LinkSuccessPayload,
  type PlaidLinkMetadata,
} from "@/lib/portal/plaid-link-complete";

const ACCOUNTS_PATH = "/portal/accounts";

/**
 * Landing page for the Plaid OAuth redirect. An OAuth bank sends the browser
 * here after login; we re-initialize Plaid Link with the original link token
 * (persisted in sessionStorage by plaid-link-button) plus `receivedRedirectUri`,
 * which lets Link finish the flow. The mode-appropriate side-effects run via the
 * shared helper, then we either show the account picker (new-link) or return the
 * user to their accounts (reauth / enable-products / account-selection).
 *
 * Rendered ssr:false (see plaid-oauth-resume-dynamic) — react-plaid-link touches
 * `window`, so window/sessionStorage are always available on mount here.
 */
export function PlaidOAuthResume() {
  const router = useRouter();
  const portalFetch = usePortalFetch();

  // Read once on mount. null = nothing to resume.
  const [ctx] = useState(getPlaidOAuthCtx);
  const [picker, setPicker] = useState<LinkSuccessPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);
  // The OAuth return URL Plaid needs to resume the flow.
  const receivedRedirectUri = window.location.href;

  const goToAccounts = useCallback(() => {
    router.replace(ACCOUNTS_PATH);
    router.refresh();
  }, [router]);

  const onSuccess = useCallback(
    async (publicToken: string, metadata?: PlaidLinkMetadata) => {
      if (handledRef.current || !ctx) return;
      handledRef.current = true;
      clearPlaidOAuthCtx();

      const result = await runPlaidLinkSuccess({
        mode: ctx.mode,
        itemId: ctx.itemId,
        publicToken,
        metadata,
        portalFetch,
      });

      if (result.kind === "error") {
        setError(result.message);
        return;
      }
      if (result.kind === "link") {
        setPicker(result.payload);
        return;
      }
      goToAccounts();
    },
    [ctx, portalFetch, goToAccounts],
  );

  const onExit = useCallback(() => {
    clearPlaidOAuthCtx();
    goToAccounts();
  }, [goToAccounts]);

  const { open, ready } = usePlaidLink({
    token: ctx?.token ?? null,
    receivedRedirectUri,
    onSuccess,
    onExit,
  });

  // Once the token is loaded and Link is ready, resume the OAuth flow. With
  // receivedRedirectUri set, open() completes the redirect rather than showing a
  // new modal. `handledRef` (set synchronously at the top of onSuccess) guards
  // against a second open() after the result comes back.
  useEffect(() => {
    if (ctx && ready && !handledRef.current) open();
  }, [ctx, ready, open]);

  if (picker) {
    return <PlaidAccountPicker payload={picker} onClose={goToAccounts} />;
  }

  const message = error
    ? { title: "Linking didn’t finish", body: error }
    : ctx === null
      ? {
          title: "Nothing to resume",
          body: "This page finishes connecting a bank. Start from your accounts.",
        }
      : null;

  if (!message) return <OAuthResumeSpinner />;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-[15px] font-semibold text-ink">{message.title}</h1>
      <p className="text-[13px] text-ink-3">{message.body}</p>
      <Link
        href={ACCOUNTS_PATH}
        className="mt-1 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-on"
      >
        Back to accounts
      </Link>
    </div>
  );
}
