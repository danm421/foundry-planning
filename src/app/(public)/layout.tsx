import Link from "next/link";
import Image from "next/image";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-hair bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center" aria-label="Foundry Planning home">
            <Image
              src="/brand/lockup-horizontal.svg"
              alt="Foundry Planning"
              width={160}
              height={28}
              priority
            />
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link
              href="/pricing"
              className="text-ink-2 hover:text-accent transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/legal"
              className="text-ink-2 hover:text-accent transition-colors"
            >
              Legal
            </Link>
            <Link
              href="/sign-in"
              className="text-ink-2 hover:text-accent transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-hair">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono uppercase tracking-wider">
            © 2026 Foundry Planning
          </p>
          <ul className="flex gap-5">
            <li>
              <Link href="/legal/tos" className="hover:text-accent">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/legal/dpa" className="hover:text-accent">
                DPA
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" className="hover:text-accent">
                Privacy
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
