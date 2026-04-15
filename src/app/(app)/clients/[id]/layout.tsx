import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import TabLink from "@/components/tab-link";

interface ClientLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

const tabs = [
  { label: "Balance Sheet", href: "balance-sheet" },
  { label: "Income & Expenses", href: "income-expenses" },
  { label: "Cash Flow", href: "cash-flow" },
  { label: "Settings", href: "settings" },
];

export default async function ClientLayout({ children, params }: ClientLayoutProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

  return (
    <div>
      {/* Client header */}
      <div className="mb-6">
        <nav className="mb-1 text-sm text-gray-500">
          <Link href="/clients" className="hover:text-gray-700">
            Clients
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900">{client.name}</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <TabLink key={tab.href} clientId={id} tab={tab} />
          ))}
        </nav>
      </div>

      {children}
    </div>
  );
}
