export const metadata = {
  title: "Checkout unavailable — Foundry Planning",
  robots: { index: false, follow: false },
};

/**
 * Where /api/checkout/start sends a buyer when it cannot mint a Stripe
 * Checkout session — a Stripe outage, or an environment missing its price
 * IDs (previews and local dev, where they are deliberately absent). The
 * underlying error goes to the logs; the buyer gets a way forward.
 */
export default function CheckoutUnavailablePage() {
  return (
    <section className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">
        We couldn&rsquo;t start your trial<span className="dot">.</span>
      </h1>
      <p className="mt-4 text-ink-2">
        Nothing was charged. Try again in a moment, or email{" "}
        <a
          className="text-accent hover:text-accent-ink"
          href="mailto:support@foundryplanning.com"
        >
          support@foundryplanning.com
        </a>{" "}
        and we&rsquo;ll set you up by hand.
      </p>
      <p className="mt-8">
        <a
          className="text-sm text-accent hover:text-accent-ink"
          href="https://foundryplanning.com/pricing"
        >
          Back to pricing
        </a>
      </p>
    </section>
  );
}
