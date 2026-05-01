import PricingCard from "./PricingCard";

export const metadata = {
  title: "Pricing — Foundry Planning",
  description: "$199/month per advisor. 14-day trial. Cancel anytime.",
};

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        01 · Pricing
      </p>
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        One price. Everything in Foundry.
      </h1>
      <p className="mt-4 text-ink-2">
        No tiers, no seat-tier games, no enterprise SKU. Per advisor, per month.
      </p>
      <div className="mt-10">
        <PricingCard />
      </div>
      <p className="mt-6 text-center text-xs text-ink-3">
        Card required at trial start. We charge after the 14-day trial unless
        you cancel.
      </p>
    </section>
  );
}
