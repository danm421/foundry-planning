import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-700 bg-gray-900">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/clients" className="text-xl font-bold text-gray-100">
              Foundry Planning
            </Link>
            <nav className="flex items-center gap-4">
              <Link href="/clients" className="text-sm text-gray-400 hover:text-gray-200">
                Clients
              </Link>
              <Link href="/cma" className="text-sm text-gray-400 hover:text-gray-200">
                CMA
              </Link>
            </nav>
          </div>
          <UserButton />
        </div>
      </header>
      <main className="flex-1 bg-gray-950">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
      <footer className="border-t border-gray-700 bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <Link href="/clients" className="text-lg font-bold text-gray-100">
                Foundry Planning
              </Link>
              <p className="mt-3 text-sm text-gray-400">
                Cash flow-based financial planning for advisors.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                Product
              </h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-400">
                <li>
                  <Link href="/clients" className="hover:text-gray-200">
                    Clients
                  </Link>
                </li>
                <li>
                  <Link href="/cma" className="hover:text-gray-200">
                    CMA
                  </Link>
                </li>
                <li>
                  <span className="text-gray-500">Features</span>
                </li>
                <li>
                  <span className="text-gray-500">Pricing</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                Resources
              </h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-400">
                <li>
                  <span className="text-gray-500">Documentation</span>
                </li>
                <li>
                  <span className="text-gray-500">Support</span>
                </li>
                <li>
                  <span className="text-gray-500">Changelog</span>
                </li>
                <li>
                  <span className="text-gray-500">Status</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                Company
              </h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-400">
                <li>
                  <a
                    href="https://foundryfin.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-gray-200"
                  >
                    foundryfin.com
                  </a>
                </li>
                <li>
                  <span className="text-gray-500">About</span>
                </li>
                <li>
                  <span className="text-gray-500">Contact</span>
                </li>
                <li>
                  <span className="text-gray-500">Privacy</span>
                </li>
                <li>
                  <span className="text-gray-500">Terms</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-gray-800 pt-6 text-sm text-gray-500 sm:flex-row">
            <p>&copy; {new Date().getFullYear()} Foundry Planning. All rights reserved.</p>
            <p>Built for financial advisors.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
