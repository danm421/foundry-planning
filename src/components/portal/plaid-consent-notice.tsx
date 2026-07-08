import type { ReactElement } from "react";

const FOUNDRY_PRIVACY_URL = "https://foundryplanning.com/legal/privacy";
const PLAID_EUPP_URL = "https://plaid.com/legal/#end-user-privacy-policy";

/**
 * Inline clickwrap disclosure shown beneath the first-time "Link bank" button.
 * Satisfies Plaid's "Provide required notices and obtain consent" requirement:
 * discloses Plaid usage + links Foundry's Privacy Policy and Plaid's End User
 * Privacy Policy. Proceeding to link an account constitutes agreement; no
 * consent record is stored.
 */
export function PlaidConsentNotice(): ReactElement {
  return (
    <p className="mt-2 max-w-prose text-[12px] leading-snug text-ink-3">
      Foundry uses Plaid to securely connect your accounts. By linking an
      account, you agree to Foundry&apos;s{" "}
      <a
        href={FOUNDRY_PRIVACY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-2 underline hover:text-ink"
      >
        Privacy Policy
      </a>{" "}
      and Plaid&apos;s{" "}
      <a
        href={PLAID_EUPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-2 underline hover:text-ink"
      >
        End User Privacy Policy
      </a>
      .
    </p>
  );
}
