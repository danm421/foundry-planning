import { listPromoCodes, listPlanPrices, type PromoCodeRow } from "@/lib/billing/promo-codes";
import type { PlanPrice } from "@/lib/billing/promo-discount-math";
import PromoCodesClient from "./promo-codes-client";

export const dynamic = "force-dynamic";

export default async function PromoCodesPage() {
  // Neither read needs the other, so start both before awaiting either — they
  // are the page's whole latency and they each fail on their own terms.
  //
  // The prices fallback is attached here rather than at its await below: until
  // then the promise carries no handler, so a rejection while the codes read is
  // still in flight counts as unhandled. Next.js logs those rather than crashing
  // (node-environment-extensions/process-error-handlers.js), so the page still
  // renders — but the log reads like a fault when it is a case handled by design.
  const codesRead = listPromoCodes();
  const pricesRead = listPlanPrices().catch((): PlanPrice[] => []);

  let codes: PromoCodeRow[] = [];
  let truncated = false;
  let loadError: string | null = null;
  try {
    const res = await codesRead;
    codes = res.rows;
    truncated = res.truncated;
  } catch (err) {
    // Stripe being unreachable shouldn't blank the page — the create form still
    // works, and the banner says why the list is empty rather than implying
    // there are no codes.
    loadError = err instanceof Error ? err.message : "Could not reach Stripe.";
  }

  // Plan prices drive the "what this code does to each plan" preview. Failing
  // to read them is not fatal: the form drops the preview and the server still
  // refuses a discount that would bill $0, so the guarantee doesn't depend on
  // this call succeeding.
  const plans = await pricesRead;

  return (
    <PromoCodesClient
      initialCodes={codes}
      truncated={truncated}
      loadError={loadError}
      plans={plans}
    />
  );
}
