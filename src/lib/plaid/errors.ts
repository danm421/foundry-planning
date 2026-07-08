/**
 * Shared Plaid error-shape extractors and the code sets that drive the
 * item-health UI. Plaid SDK errors carry the structured Plaid error in
 * `response.data` (error_code / error_message); fall back to the generic Error
 * message. Callers return `{ ok: false, errorCode, errorMessage }`.
 *
 * `REAUTH_CODES` (ITEM_LOGIN_REQUIRED / PENDING_EXPIRATION / PENDING_DISCONNECT)
 * map to the Re-authenticate (update-mode) flow; `REVOKED_CODES` map to Unlink
 * (access is gone, update mode can't fix it). `needsUserAction` is the union
 * predicate over a stored last_refresh_error; `isReauthError` tests a raw error.
 */
export function plaidErrorCode(err: unknown): string {
  const e = err as {
    response?: { data?: { error_code?: string } };
  };
  return e.response?.data?.error_code ?? "UNKNOWN";
}

export function plaidErrorMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { error_message?: string } };
    message?: string;
  };
  return e.response?.data?.error_message ?? e.message ?? "Plaid error";
}

export const REAUTH_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
]);

// Access revoked at the bank/Plaid — update mode cannot fix these; the UI
// offers Unlink (re-linking creates a fresh item) instead of Re-authenticate.
export const REVOKED_CODES = new Set([
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
]);

/** True when the stored last_refresh_error requires the client to act. */
export function needsUserAction(code: string | null): boolean {
  return code != null && (REAUTH_CODES.has(code) || REVOKED_CODES.has(code));
}

export function isReauthError(err: unknown): boolean {
  return REAUTH_CODES.has(plaidErrorCode(err));
}
