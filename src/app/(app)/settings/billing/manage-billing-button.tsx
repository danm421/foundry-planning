"use client";

import type { ReactElement } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded border border-hair bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Opening Stripe…" : "Manage billing"}
    </button>
  );
}

/**
 * Native POST form to the Customer Portal route. The route returns a 303
 * redirect to Stripe's hosted portal, so a real form submit (not fetch)
 * lets the browser follow it straight there — no client-side redirect glue.
 */
export default function ManageBillingButton(): ReactElement {
  return (
    <form id="manage" method="post" action="/api/billing/portal">
      <SubmitButton />
    </form>
  );
}
