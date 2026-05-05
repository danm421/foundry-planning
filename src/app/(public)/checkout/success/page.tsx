import Link from "next/link";
import SuccessPolling from "./SuccessPolling";

export const metadata = {
  title: "Welcome to Foundry — finishing setup",
  robots: { index: false, follow: false },
};

const SESSION_ID_RE = /^cs_(test|live)_[a-zA-Z0-9_-]{10,}$/;

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.session_id;
  const sessionId = Array.isArray(raw) ? raw[0] : raw;

  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return (
      <section className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Missing checkout session.
        </h1>
        <p className="mt-4 text-ink-2">
          This page only makes sense after a Stripe Checkout. Head back to{" "}
          <Link href="/pricing" className="text-accent hover:underline">
            pricing
          </Link>{" "}
          to start.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl px-6 py-24">
      <SuccessPolling sessionId={sessionId} />
    </section>
  );
}
