import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgOwner } from "@/lib/authz";
import Forbidden from "../forbidden";

function FounderBillingPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Foundry Financial — Founder Plan</h1>
        <p className="text-sm text-ink-3">
          You have full access to all features as the founder of this product.
          No subscription is required.
        </p>
      </header>
      <div className="rounded border border-hair bg-card p-4 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-4">Subscription status</dt>
          <dd className="text-ink">founder</dd>
          <dt className="text-ink-4">Entitlements</dt>
          <dd className="text-ink">ai_import</dd>
        </dl>
      </div>
      <button
        type="button"
        disabled
        title="Founder accounts don't have a Stripe subscription."
        className="w-fit cursor-not-allowed rounded border border-hair bg-paper px-3 py-1.5 text-sm text-ink-4"
      >
        No subscription to manage
      </button>
    </div>
  );
}

function NonFounderBillingPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-base font-medium text-ink">Billing</h1>
      <p className="text-sm text-ink-3">Billing details coming soon.</p>
    </div>
  );
}

export default async function BillingSettingsPage(): Promise<ReactElement> {
  try {
    await requireOrgOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return <Forbidden requiredRole="owner" />;
    }
    throw err;
  }

  const { sessionClaims } = await auth();
  const meta =
    (sessionClaims as { org_public_metadata?: { is_founder?: boolean } } | null)
      ?.org_public_metadata ?? {};
  const isFounder = meta.is_founder === true;

  return isFounder ? <FounderBillingPanel /> : <NonFounderBillingPanel />;
}
