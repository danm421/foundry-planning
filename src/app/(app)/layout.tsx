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
    </div>
  );
}
