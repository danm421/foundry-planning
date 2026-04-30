"use client";

import { useTransition } from "react";

interface Props {
  /** "{state-kind}:{date-key}" — what we'll write into the cookie. */
  dismissKey: string;
}

export default function SubscriptionBannerDismiss({ dismissKey }: Props) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Dismiss banner"
      data-dismiss="true"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const { dismissBanner } = await import("./subscription-banner-actions");
          await dismissBanner(dismissKey);
        });
      }}
      className="ml-auto text-ink-3 hover:text-ink-1"
    >
      ×
    </button>
  );
}
