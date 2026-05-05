import Link from "next/link";

export const metadata = {
  title: "Legal — Foundry Planning",
  description:
    "Terms of Service, Privacy Policy, and Data Processing Addendum for Foundry Planning.",
};

const DOCS = [
  {
    href: "/legal/tos",
    title: "Terms of Service",
    blurb:
      "How firms use Foundry, what we promise, and where the limits sit.",
  },
  {
    href: "/legal/privacy",
    title: "Privacy Policy",
    blurb:
      "What we collect, why we collect it, and who we share it with.",
  },
  {
    href: "/legal/dpa",
    title: "Data Processing Addendum",
    blurb:
      "How we process client data on your behalf, including subprocessors.",
  },
];

export default function LegalIndexPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Legal
      </p>
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Foundry Planning legal documents.
      </h1>
      <p className="mt-4 text-ink-2">
        Each of these is a working draft. We&rsquo;re running with them in
        good faith while we finish counsel review &mdash; email{" "}
        <a
          className="text-accent hover:underline"
          href="mailto:support@foundryplanning.com"
        >
          support@foundryplanning.com
        </a>{" "}
        for the current draft of record.
      </p>

      <ul className="mt-10 space-y-4">
        {DOCS.map((doc) => (
          <li key={doc.href}>
            <Link
              href={doc.href}
              className="block rounded-md border border-hair p-5 transition-colors hover:border-accent/60 hover:bg-card-hover"
            >
              <p className="text-base font-semibold text-ink">{doc.title}</p>
              <p className="mt-1 text-sm text-ink-3">{doc.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
