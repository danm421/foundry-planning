import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function HomePage() {
  const { userId, orgId } = await auth();
  if (userId && orgId) redirect("/clients");

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center sm:py-32">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        00 · Foundry Planning
      </p>
      <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        Cash-flow planning, calibrated for advisors.
      </h1>
      <p className="mt-6 max-w-xl text-balance text-lg text-ink-2">
        A projection engine, federal and state tax model, estate-transfer
        ledger, and Monte Carlo — wired to the way advisors actually plan.
      </p>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/pricing"
          className="rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-on hover:bg-accent-deep"
        >
          View pricing
        </Link>
        <Link
          href="/sign-in"
          className="rounded-md border border-hair px-6 py-3 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
