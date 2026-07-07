"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import {
  runPlaidLinkSuccess,
  setPlaidOAuthCtx,
  clearPlaidOAuthCtx,
  type LinkSuccessPayload,
} from "@/lib/portal/plaid-link-complete";

type Props =
  | {
      mode: "link";
      onLinkSuccess: (payload: LinkSuccessPayload) => void;
    }
  | {
      mode: "reauth";
      itemId: string;
    }
  | {
      mode: "enable-products";
      itemId: string;
    }
  | {
      mode: "account-selection";
      itemId: string;
      onSelectionComplete: () => void;
    };

export function PlaidLinkButton(props: Props) {
  const router = useRouter();
  const portalFetch = usePortalFetch();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const itemId = "itemId" in props ? props.itemId : undefined;

  const onSuccess = useCallback(
    async (
      publicToken: string,
      metadata?: {
        institution: { institution_id?: string; name?: string } | null;
      },
    ) => {
      const result = await runPlaidLinkSuccess({
        mode: props.mode,
        itemId,
        publicToken,
        metadata,
        portalFetch,
      });

      // Inline (non-OAuth) completion — drop the OAuth handoff context so a
      // later visit to /portal/oauth can't resume a stale flow.
      clearPlaidOAuthCtx();

      if (result.kind === "error") {
        alert(result.message);
        return;
      }
      if (result.kind === "link" && props.mode === "link") {
        props.onLinkSuccess(result.payload);
        return;
      }
      if (props.mode === "account-selection") {
        props.onSelectionComplete();
        return;
      }
      router.refresh();
    },
    [props, itemId, router, portalFetch],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body =
        props.mode === "reauth"
          ? JSON.stringify({ itemId: props.itemId })
          : props.mode === "enable-products"
            ? JSON.stringify({ itemId: props.itemId, enableProducts: true })
            : props.mode === "account-selection"
              ? JSON.stringify({ itemId: props.itemId, accountSelection: true })
              : "{}";
      const r = await portalFetch("/api/portal/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!r.ok) {
        alert(
          r.status === 429
            ? "Too many attempts — please wait a bit and try again."
            : "Could not start linking. Please try again.",
        );
        return;
      }
      const { linkToken: token } = (await r.json()) as { linkToken: string };
      setLinkToken(token);
    } finally {
      setBusy(false);
    }
  }, [busy, props, portalFetch]);

  // When the linkToken is set and Plaid Link is ready, open the modal.
  // usePlaidLink requires the token at hook construction time, not at click
  // time. The first click mints the token; the re-render with the token causes
  // `ready` to flip true; this effect opens the modal once after commit.
  //
  // Before opening, persist the link context to sessionStorage: an OAuth bank
  // redirects the whole tab out and back to /portal/oauth, which reads this to
  // resume the flow (see plaid-oauth-resume). Inline flows clear it in onSuccess.
  useEffect(() => {
    if (linkToken && ready) {
      setPlaidOAuthCtx({ token: linkToken, mode: props.mode, itemId });
      open();
      setLinkToken(null);
    }
  }, [linkToken, ready, open, props.mode, itemId]);

  const label =
    props.mode === "link"
      ? "Link bank"
      : props.mode === "reauth"
        ? "Re-authenticate"
        : props.mode === "account-selection"
          ? "Find more accounts"
          : "Enable spending insights";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
