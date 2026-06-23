"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlaidLinkButton } from "./plaid-link-button";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

export function InstitutionRow({
  itemId,
  institutionName,
  statusLabel,
  needsReauth,
  editEnabled,
  needsTransactionsConsent,
}: {
  itemId: string;
  institutionName: string;
  statusLabel: string;
  needsReauth: boolean;
  editEnabled: boolean;
  needsTransactionsConsent: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const portalFetch = usePortalFetch();

  const refresh = () =>
    startTransition(async () => {
      const r = await portalFetch(`/api/portal/plaid/items/${itemId}/refresh`, {
        method: "POST",
      });
      const json = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        needsReauth?: boolean;
      };
      if (!r.ok) {
        alert("Refresh failed. Try again.");
        return;
      }
      if (json.ok === false && json.needsReauth) {
        alert("This institution needs to be re-authenticated.");
      }
      router.refresh();
    });

  const unlink = () => {
    if (!window.confirm(`Unlink ${institutionName}?`)) return;
    startTransition(async () => {
      const r = await portalFetch(`/api/portal/plaid/items/${itemId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        alert("Unlink failed. Try again.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium text-ink">
          {institutionName}
        </p>
        <p
          className={
            needsReauth
              ? "text-[12px] text-amber-600"
              : "text-[12px] text-ink-subtle"
          }
        >
          {statusLabel}
        </p>
      </div>
      {editEnabled && (
        <div className="flex shrink-0 items-center gap-2">
          {needsReauth ? (
            <PlaidLinkButton mode="reauth" itemId={itemId} />
          ) : (
            <>
              {needsTransactionsConsent && (
                <PlaidLinkButton mode="enable-products" itemId={itemId} />
              )}
              <button
                type="button"
                onClick={refresh}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-xs hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {/* refresh icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-3.5"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                Refresh
              </button>
            </>
          )}
          <button
            type="button"
            onClick={unlink}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-red-600 shadow-xs hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {/* unlink/trash icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Unlink
          </button>
        </div>
      )}
    </li>
  );
}
