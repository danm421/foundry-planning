import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

const PILLARS = [
  {
    title: "Speed",
    body: "Intake to a finished, presentable plan in one sitting — not a week of spreadsheet wrangling.",
  },
  {
    title: "AI workflows",
    body: "Document extraction and data entry run themselves, so your time goes to advising, not assembling.",
  },
  {
    title: "Depth",
    body: "One engine from a simple retirement projection to a multi-entity estate and tax plan.",
  },
] as const;

export default async function HomePage() {
  const { userId, orgId } = await auth();
  if (userId && orgId) redirect("/clients");

  return (
    <section className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
      {/* Hero */}
      <p className="mb-5 font-mono text-xs uppercase tracking-[0.22em] text-accent">
        00 · <span className="text-ink-4">The planning workspace for advisors</span>
      </p>
      <h1 className="max-w-3xl text-balance text-5xl font-extrabold leading-[1.04] tracking-[-0.035em] text-ink sm:text-6xl">
        Walk in with the plan,{" "}
        <span className="text-accent">not the spreadsheet.</span>
      </h1>
      <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-3">
        Foundry turns client data into a finished plan — cash flow, tax,
        investments, and estate — with AI workflows doing the busywork. Simple
        retirement case or complex estate, it&rsquo;s one workspace.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-5">
        <Link
          href="/sign-up"
          className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accent-on transition-colors hover:bg-accent-ink"
        >
          Start free trial
        </Link>
        <Link
          href="/pricing"
          className="text-sm font-semibold text-secondary transition-colors hover:text-secondary-ink"
        >
          View pricing →
        </Link>
      </div>
      <p className="mt-5 font-mono text-xs text-ink-4">
        14-day trial · everything included · no setup call required
      </p>

      {/* Supporting pillars */}
      <div className="mt-20 grid gap-5 sm:grid-cols-3">
        {PILLARS.map((pillar) => (
          <div key={pillar.title} className="card p-6">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-secondary">
              {pillar.title}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-3">
              {pillar.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
