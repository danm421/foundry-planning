export default function LegalPage({
  title,
  eyebrow,
  lastUpdated,
  children,
}: {
  title: string;
  eyebrow: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        {eyebrow}
      </p>
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-wider text-ink-3">
        Last updated {lastUpdated}
      </p>

      <aside className="mt-8 rounded-md border border-hair bg-hair-2/30 p-4 text-sm text-ink-2">
        <p>
          <strong className="text-ink">Pending counsel review.</strong> This
          document describes Foundry Planning&rsquo;s current practices in good
          faith but has not been reviewed by external counsel. Email{" "}
          <a
            className="text-accent hover:underline"
            href="mailto:support@foundryplanning.com"
          >
            support@foundryplanning.com
          </a>{" "}
          for the current draft of record.
        </p>
      </aside>

      <div className="prose-legal mt-8 space-y-8 text-sm leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-ink [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1 [&_a]:text-accent [&_a:hover]:underline">
        {children}
      </div>
    </article>
  );
}
