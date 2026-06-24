/**
 * The single source of truth for which account API body fields Plaid owns on a
 * linked account. Imported by BOTH the portal account PUT route (which rejects
 * these keys with 400 on a Plaid-linked row) and the portal accounts UI (which
 * omits them from the PUT body and renders them read-only). One list here
 * removes the server↔UI drift those two surfaces previously duplicated.
 *
 * These are request-body field names (`value`, `last4`, `custodian`), not DB
 * columns. The portal UI never sends `custodian`, so stripping it from the body
 * is a no-op there — but iterating the shared list keeps the UI honest if the
 * portal ever gains a custodian field.
 *
 * Plain constant only — safe to import from a "use client" component (no
 * server-only deps, unlike the rest of `src/lib/portal/`).
 */
export const PLAID_LOCKED_FIELDS = ["value", "last4", "custodian"] as const;

/**
 * The liability equivalent: the body fields Plaid owns on a linked debt. The
 * portal liability PUT route rejects these with 400 on a Plaid-linked row, and
 * the portal debt UI renders them read-only. Balance is institution-synced;
 * name / liabilityType / owners stay client-editable. The synced display
 * metadata (statementBalance / minimumPayment / aprPercentage / nextPaymentDueDate)
 * is never sent by the form, so listing `balance` alone keeps the guard honest.
 */
export const LIABILITY_PLAID_LOCKED_FIELDS = ["balance"] as const;
