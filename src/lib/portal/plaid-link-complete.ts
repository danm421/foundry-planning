// Shared "Plaid Link onSuccess" side-effects for the client portal.
//
// The four Link modes each fire different network calls once Plaid Link
// returns a public token. This logic is invoked from two places: the inline
// path in `plaid-link-button.tsx` (non-OAuth banks) and the OAuth resume page
// `plaid-oauth-resume.tsx` (OAuth banks, after a full-page redirect). Keeping
// the side-effects here — and letting each caller own its own UI continuation
// (in-memory callbacks vs. navigation) — keeps the two paths identical.

export type PlaidLinkMode =
  | "link"
  | "reauth"
  | "enable-products"
  | "account-selection";

/** Response shape of `POST /api/portal/plaid/exchange` (new-link mode). */
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
  existingLiabilityCandidates: Array<{
    id: string;
    name: string;
    liabilityType: string | null;
    balance: string;
  }>;
};

/** Persisted across the OAuth full-page redirect (sessionStorage). */
export type PlaidLinkCtx = {
  token: string;
  mode: PlaidLinkMode;
  itemId?: string;
};

export const PLAID_OAUTH_CTX_KEY = "plaid_oauth_ctx";

/** The subset of react-plaid-link's onSuccess metadata we use. */
export type PlaidLinkMetadata = {
  institution: { institution_id?: string; name?: string } | null;
};

export type PortalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

// --- sessionStorage handoff (survives the OAuth full-page redirect) ----------
// The context is written by plaid-link-button before open() and read by the
// /portal/oauth resume page. All access goes through these guarded helpers so no
// component touches sessionStorage directly or throws on it (Safari private mode,
// embedded webviews, quota).

export function getPlaidOAuthCtx(): PlaidLinkCtx | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLAID_OAUTH_CTX_KEY);
    return raw ? (JSON.parse(raw) as PlaidLinkCtx) : null;
  } catch {
    return null;
  }
}

export function setPlaidOAuthCtx(ctx: PlaidLinkCtx): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PLAID_OAUTH_CTX_KEY, JSON.stringify(ctx));
  } catch {
    // Storage unavailable — OAuth resume degrades; inline linking still works.
  }
}

export function clearPlaidOAuthCtx(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PLAID_OAUTH_CTX_KEY);
  } catch {
    // Ignore — nothing to clean up if storage is inaccessible.
  }
}

export type PlaidLinkSuccessResult =
  | { kind: "link"; payload: LinkSuccessPayload }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Runs the network side-effects for a completed Plaid Link flow. Returns a
 * discriminated result the caller uses to drive UI:
 *  - `link` → show the account picker with `payload`
 *  - `done` → the mode had no follow-up UI (reauth / enable-products /
 *             account-selection); refresh or navigate
 *  - `error` → surface `message`
 */
export async function runPlaidLinkSuccess(args: {
  mode: PlaidLinkMode;
  itemId?: string;
  publicToken: string;
  /** Raw metadata from react-plaid-link's onSuccess. */
  metadata?: PlaidLinkMetadata;
  portalFetch: PortalFetch;
}): Promise<PlaidLinkSuccessResult> {
  const { mode, itemId, publicToken, metadata, portalFetch } = args;

  if (mode === "link") {
    const institution = metadata?.institution
      ? {
          id: metadata.institution.institution_id,
          name: metadata.institution.name,
        }
      : undefined;
    const r = await portalFetch("/api/portal/plaid/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicToken, institution }),
    });
    if (!r.ok) {
      return { kind: "error", message: "Could not complete linking. Please try again." };
    }
    const payload = (await r.json()) as LinkSuccessPayload;
    return { kind: "link", payload };
  }

  if (mode === "account-selection") {
    // Plaid persists the updated account selection itself; clear the
    // new-accounts prompt so it doesn't linger after the user acted.
    if (itemId) {
      await portalFetch(`/api/portal/plaid/items/${itemId}/dismiss-new-accounts`, {
        method: "POST",
      }).catch(() => undefined); // best-effort: selection already succeeded
    }
    return { kind: "done" };
  }

  // reauth + enable-products both operate on an existing item.
  if (!itemId) {
    return { kind: "error", message: "Something went wrong. Please refresh and try again." };
  }

  if (mode === "enable-products") {
    const syncRes = await portalFetch(
      `/api/portal/plaid/items/${itemId}/sync`,
      { method: "POST" },
    );
    if (!syncRes.ok) {
      return { kind: "error", message: "Could not enable spending insights. Please try again." };
    }
    await portalFetch(`/api/portal/plaid/items/${itemId}/refresh`, {
      method: "POST",
    });
    return { kind: "done" };
  }

  // reauth
  const r = await portalFetch(
    `/api/portal/plaid/items/${itemId}/reauth-complete`,
    { method: "POST" },
  );
  if (!r.ok) {
    return { kind: "error", message: "Re-authentication failed to record. Please refresh and try again." };
  }
  return { kind: "done" };
}
