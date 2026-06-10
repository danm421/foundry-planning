import Link from "next/link";

const STOREFRONT = "https://foundryplanning.com";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[var(--color-paper)] text-[var(--color-ink)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-40 h-[42rem] w-[42rem] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(31,158,140,0.18), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -left-40 h-[44rem] w-[44rem] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(96,165,250,0.06), transparent 70%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link
          href={STOREFRONT}
          className="inline-flex items-center"
          aria-label="Foundry Planning"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/lockup-horizontal.svg"
            alt="Foundry Planning"
            className="h-7 w-auto"
          />
        </Link>
        <Link
          href={STOREFRONT}
          className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)]"
        >
          ← Back to site
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-10 pt-2 sm:px-6">
        {children}
      </main>

      <footer className="relative z-10 border-t border-[var(--color-hair)] px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-[0.72rem] text-[var(--color-ink-3)]">
          <span className="font-mono uppercase tracking-[0.16em]">
            © Foundry Finance LLC
          </span>
          <div className="flex gap-5">
            <Link
              href={`${STOREFRONT}/security`}
              className="transition-colors hover:text-[var(--color-ink)]"
            >
              Security
            </Link>
            <Link
              href={`${STOREFRONT}/about`}
              className="transition-colors hover:text-[var(--color-ink)]"
            >
              About
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
