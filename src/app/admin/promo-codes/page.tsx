import { listPromoCodes, type PromoCodeRow } from "@/lib/billing/promo-codes";
import PromoCodesClient from "./promo-codes-client";

export const dynamic = "force-dynamic";

export default async function PromoCodesPage() {
  let codes: PromoCodeRow[] = [];
  let truncated = false;
  let loadError: string | null = null;
  try {
    ({ rows: codes, truncated } = await listPromoCodes());
  } catch (err) {
    // Stripe being unreachable shouldn't blank the page — the create form still
    // works, and the banner says why the list is empty rather than implying
    // there are no codes.
    loadError = err instanceof Error ? err.message : "Could not reach Stripe.";
  }
  return (
    <PromoCodesClient initialCodes={codes} truncated={truncated} loadError={loadError} />
  );
}
