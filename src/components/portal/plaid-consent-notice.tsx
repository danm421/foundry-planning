"use client";

import type { ReactElement } from "react";

const FOUNDRY_PRIVACY_URL = "https://foundryplanning.com/legal/privacy";
const PLAID_EUPP_URL = "https://plaid.com/legal/#end-user-privacy-policy";

const LINK_CLS = "text-ink-2 underline hover:text-ink";

/**
 * Clickwrap disclosure that sits beside the account-linking buttons. Satisfies
 * Plaid's "Provide required notices and obtain consent" requirement: discloses
 * Plaid usage + links Foundry's Privacy Policy and Plaid's End User Privacy
 * Policy. Proceeding to link an account constitutes agreement; no consent
 * record is stored.
 *
 * The notice lives in a hover/focus tooltip rather than an inline paragraph so
 * the Accounts canvas stays client-presentable. Two deliberate differences from
 * `FieldTooltip`: the panel is *interactive* (the policy links must be
 * clickable to count as notice), and it opens downward and right-aligned —
 * this badge sits in the page header, where an upward panel would open
 * offscreen.
 */
export function PlaidConsentNotice(): ReactElement {
  return (
    <span className="group relative inline-flex items-center gap-1.5">
      <span className="text-[12px] text-ink-3">Secured by Plaid</span>
      <button
        type="button"
        aria-label="How Foundry uses Plaid"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-ink-3 text-[10px] font-semibold leading-none text-ink-2 hover:border-ink-2 hover:text-ink focus:border-ink-2 focus:text-ink focus:outline-none"
      >
        ?
      </button>
      {/* Positioned wrapper pads the badge → panel gap from the inside, so the
          pointer never crosses dead space and drops the hover. */}
      <span className="invisible absolute right-0 top-full z-50 pt-2 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 motion-reduce:transition-none">
        <span
          role="tooltip"
          className="block w-72 max-w-[calc(100vw-2rem)] rounded-md border border-hair bg-card px-3 py-2 text-left text-xs leading-snug text-ink-2 shadow-lg"
        >
          Foundry uses Plaid to securely connect your accounts. By linking an
          account, you agree to Foundry&apos;s{" "}
          <a
            href={FOUNDRY_PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLS}
          >
            Privacy Policy
          </a>{" "}
          and Plaid&apos;s{" "}
          <a
            href={PLAID_EUPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLS}
          >
            End User Privacy Policy
          </a>
          .
        </span>
      </span>
    </span>
  );
}
