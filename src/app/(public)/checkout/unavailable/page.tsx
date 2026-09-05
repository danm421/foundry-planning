export const metadata = {
  title: "Checkout unavailable — Foundry Planning",
  robots: { index: false, follow: false },
};

/**
 * A standing explanation page for a buyer whose Stripe Checkout attempt
 * failed. Nothing in the app redirects here automatically: the setup step's
 * `startSignupCheckout` server action handles a Stripe failure inline,
 * returning an error string to the form instead of navigating away. This
 * page stays reachable as a direct link — e.g. from a support reply — so
 * there is still somewhere to point a buyer who hits a dead end.
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
          className="text-accent underline underline-offset-4 hover:text-accent-ink"
          href="mailto:support@foundryplanning.com"
        >
          support@foundryplanning.com
        </a>{" "}
        and we&rsquo;ll set you up by hand.
      </p>
      <p className="mt-8">
        <a
          className="text-sm text-accent underline underline-offset-4 hover:text-accent-ink"
          href="https://foundryplanning.com/pricing"
        >
          Back to pricing
        </a>
      </p>
    </section>
  );
}
