import type { ReactElement } from "react";
import type { PortalPrivacy } from "@/lib/portal/privacy";
import { PrivacyToggles } from "@/components/portal/privacy-toggles";

/**
 * The portal Settings screen. Rendered by the client's /portal/settings page
 * and, with `readOnly`, by the advisor preview — advisors see the client's
 * choices but can't change them.
 */
export function PortalSettingsView({
  privacy,
  readOnly = false,
}: {
  privacy: PortalPrivacy;
  readOnly?: boolean;
}): ReactElement {
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6 lg:p-10">
      <header className="space-y-1">
        <h1 className="text-[22px] font-semibold text-ink">Settings</h1>
        <p className="text-[13px] text-ink-3">
          Choose what your advisor can see from your budgeting tools.
        </p>
      </header>

      <section className="rounded-xl border border-hair bg-card p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Privacy &amp; sharing</h2>
          {readOnly && (
            <span className="text-[12px] text-ink-3">Only the client can change these</span>
          )}
        </div>
        <PrivacyToggles initial={privacy} readOnly={readOnly} />
      </section>

      <section className="rounded-xl border border-hair bg-card-2 p-5">
        <h2 className="mb-1 text-[13px] font-semibold text-ink-2">
          Always visible to your advisor
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-3">
          Accounts and balances, net worth, investments, and your household
          profile stay visible — your financial plan is built on them.
        </p>
      </section>
    </div>
  );
}
