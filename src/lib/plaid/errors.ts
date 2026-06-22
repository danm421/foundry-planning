/**
 * Shared Plaid error-shape extractors. Plaid SDK errors carry the structured
 * Plaid error in `response.data` (error_code / error_message); fall back to the
 * generic Error message. Callers return `{ ok: false, errorCode, errorMessage }`
 * and map `ITEM_LOGIN_REQUIRED` / `PENDING_EXPIRATION` to the re-auth UI.
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
