"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

export type LinkSuccessPayload = {
  itemId: string;
  accounts: Array<{
    plaidAccountId: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string | null;
    balance: number | null;
  }>;
  existingCandidates: Array<{
    id: string;
    name: string;
    category: string;
    subType: string;
  }>;
};

type Props =
  | {
      mode: "link";
      onLinkSuccess: (payload: LinkSuccessPayload) => void;
    }
  | {
      mode: "reauth";
      itemId: string;
    };

export function PlaidLinkButton(props: Props) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(
    async (
      publicToken: string,
      metadata: {
        institution: { institution_id?: string; name?: string } | null;
      },
    ) => {
      if (props.mode === "link") {
        const r = await fetch("/api/portal/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institution: metadata.institution
              ? {
                  id: metadata.institution.institution_id,
                  name: metadata.institution.name,
                }
              : undefined,
          }),
        });
        if (!r.ok) {
          alert("Could not complete linking. Please try again.");
          return;
        }
        const payload = (await r.json()) as LinkSuccessPayload;
        props.onLinkSuccess(payload);
        return;
      }
      // reauth mode: no exchange needed; just notify the server.
      const r = await fetch(
        `/api/portal/plaid/items/${props.itemId}/reauth-complete`,
        { method: "POST" },
      );
      if (!r.ok) {
        alert(
          "Re-authentication failed to record. Please refresh and try again.",
        );
        return;
      }
      router.refresh();
    },
    [props, router],
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
          : "{}";
      const r = await fetch("/api/portal/plaid/link-token", {
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
  }, [busy, props]);

  // When the linkToken is set and Plaid Link is ready, open the modal.
  // usePlaidLink requires the token at hook construction time, not at click
  // time. The first click mints the token; the re-render with the token causes
  // `ready` to flip true; this inline check opens the modal once.
  if (linkToken && ready) {
    open();
    setLinkToken(null);
  }

  const label = props.mode === "link" ? "Link bank" : "Re-authenticate";

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
