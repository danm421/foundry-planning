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
  { label: "Details", href: "client-data" },
  { label: "Balance Sheet", href: "balance-sheet-report" },
  { label: "Cash Flow", href: "cashflow" },
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

  const primaryFullName = `${client.firstName} ${client.lastName}`;
  const spouseFirst = client.spouseName ?? null;
  const spouseLast = client.spouseLastName ?? (spouseFirst ? client.lastName : null);
  const spouseFullName = spouseFirst ? `${spouseFirst} ${spouseLast ?? ""}`.trim() : null;
  const householdTitle = spouseFullName
    ? client.lastName && spouseLast === client.lastName
      ? `${client.firstName} & ${spouseFirst} ${client.lastName}`
      : `${primaryFullName} & ${spouseFullName}`
    : primaryFullName;

  return (
    <div>
      <div className="mb-6">
        <nav className="mb-1 text-sm text-gray-400">
          <Link href="/clients" className="hover:text-gray-200">
            Clients
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-100">{householdTitle}</span>
        </nav>
        <h1 className="text-2xl font-bold text-gray-100">{householdTitle}</h1>
        {spouseFullName && (
          <p className="mt-1 text-xs text-gray-500">
            {primaryFullName} · {spouseFullName}
          </p>
        )}
      </div>

      <div className="mb-6 border-b border-gray-700">
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
