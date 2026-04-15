import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, scenarios, accounts, liabilities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import AddAccountDialog from "@/components/add-account-dialog";
import AddLiabilityDialog from "@/components/add-liability-dialog";

interface BalanceSheetPageProps {
  params: Promise<{ id: string }>;
}

const fmt = (value: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(value)
  );

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

const CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
};

export default async function BalanceSheetPage({ params }: BalanceSheetPageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  // Verify client access
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) {
    notFound();
  }

  // Get base case scenario
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
        No base case scenario found.
      </div>
    );
  }

  // Fetch accounts and liabilities
  const [accountRows, liabilityRows] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenario.id))),
    db
      .select()
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenario.id))),
  ]);

  // Group accounts by category
  const byCategory = {
    taxable: accountRows.filter((a) => a.category === "taxable"),
    cash: accountRows.filter((a) => a.category === "cash"),
    retirement: accountRows.filter((a) => a.category === "retirement"),
  };

  const totalAssets = accountRows.reduce((sum, a) => sum + Number(a.value), 0);
  const totalLiabilities = liabilityRows.reduce((sum, l) => sum + Number(l.balance), 0);
  const netWorth = totalAssets - totalLiabilities;

  return (
    <div className="space-y-6">
      {/* Assets */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Assets</h2>
        </div>

        {(["taxable", "cash", "retirement"] as const).map((cat) => (
          <div key={cat} className="border-b border-gray-100 last:border-0">
            {/* Category header */}
            <div className="flex items-center justify-between px-6 py-2 bg-gray-50/50">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {CATEGORY_LABELS[cat]}
              </span>
              <AddAccountDialog clientId={id} category={cat} label={CATEGORY_LABELS[cat]} />
            </div>

            {/* Account rows */}
            {byCategory[cat].length === 0 ? (
              <div className="px-6 py-3 text-sm text-gray-400 italic">No accounts yet</div>
            ) : (
              <table className="min-w-full">
                <tbody className="divide-y divide-gray-50">
                  {byCategory[cat].map((account) => (
                    <tr key={account.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        {account.name}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {OWNER_LABELS[account.owner]}
                      </td>
                      <td className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                        {fmt(account.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {/* Total assets */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">Total Assets</span>
          <span className="text-sm font-bold text-gray-900">{fmt(totalAssets)}</span>
        </div>
      </div>

      {/* Liabilities */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Liabilities</h2>
          <AddLiabilityDialog clientId={id} />
        </div>

        {liabilityRows.length === 0 ? (
          <div className="px-6 py-6 text-center text-sm text-gray-400 italic">No liabilities yet</div>
        ) : (
          <table className="min-w-full">
            <tbody className="divide-y divide-gray-100">
              {liabilityRows.map((liability) => (
                <tr key={liability.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">
                    {liability.name}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {Number(liability.interestRate) > 0
                      ? `${(Number(liability.interestRate) * 100).toFixed(2)}% interest`
                      : ""}
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-red-600">
                    ({fmt(liability.balance)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Total liabilities */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">Total Liabilities</span>
          <span className="text-sm font-bold text-red-600">({fmt(totalLiabilities)})</span>
        </div>
      </div>

      {/* Net Worth */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
        <span className="text-base font-bold text-gray-900">Net Worth</span>
        <span className={`text-lg font-bold ${netWorth >= 0 ? "text-green-600" : "text-red-600"}`}>
          {fmt(netWorth)}
        </span>
      </div>
    </div>
  );
}
