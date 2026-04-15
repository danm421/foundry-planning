import Link from "next/link";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import AddClientDialog from "@/components/add-client-dialog";

export default async function ClientsPage() {
  const firmId = await getOrgId();

  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.firmId, firmId))
    .orderBy(asc(clients.lastName), asc(clients.firstName));

  const filingStatusLabels: Record<string, string> = {
    single: "Single",
    married_joint: "Married Filing Jointly",
    married_separate: "Married Filing Separately",
    head_of_household: "Head of Household",
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Clients</h1>
        <AddClientDialog />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-sm">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-400">No clients yet. Click &quot;Add Client&quot; to get started.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Filing Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">
                  Date Added
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700 bg-gray-900">
              {rows.map((client) => (
                <tr key={client.id} className="hover:bg-gray-800">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      href={`/clients/${client.id}/balance-sheet`}
                      className="font-medium text-blue-500 hover:text-blue-400"
                    >
                      {client.firstName} {client.lastName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                    {filingStatusLabels[client.filingStatus] ?? client.filingStatus}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                    {new Date(client.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
