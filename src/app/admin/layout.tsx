import Link from "next/link";
import { requireOpsAdminPage } from "@/lib/ops/ops-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Defence in depth only — each page under here gates itself, because a
  // forged router state tree can skip this layout entirely.
  await requireOpsAdminPage();
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-hair">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/admin" className="text-sm font-medium text-ink hover:text-accent transition">
            Foundry Ops
          </Link>
          <Link
            href="/clients"
            className="text-sm text-ink-3 hover:text-accent transition"
          >
            &larr; Back to app
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-10">{children}</div>
    </div>
  );
}
