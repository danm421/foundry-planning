import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import {
  listRiskProfiles,
  deriveListFlags,
  type RiskListRow,
  type RiskListFlags,
} from "@/lib/risk/queries";
import { BookSwitcher } from "@/components/book-switcher";
import { RiskLevelBadge } from "@/components/risk/risk-level-badge";
import { RiskStatusChips } from "@/components/risk/risk-status-chips";

const TOLERANCE_SOURCE_LABELS: Record<string, string> = {
  rtq_client: "Client RTQ",
  rtq_advisor: "Advisor RTQ",
  manual: "Manual",
};

const TH =
  "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

const DASH = <span className="text-ink-3">—</span>;

function formatDate(d: Date | null): ReactNode {
  return d ? <span className="tabular">{d.toISOString().slice(0, 10)}</span> : DASH;
}

function formatEnvironment(adj: number): ReactNode {
  if (adj === 0) return DASH;
  return <span className="tabular">{adj > 0 ? `+${adj}` : adj}</span>;
}

function bindingLabel(constraint: RiskListRow["bindingConstraint"]): ReactNode {
  if (constraint === "capacity") return "Capacity";
  if (constraint === "tolerance") return "Tolerance";
  return DASH;
}

interface RiskDisplayRow {
  row: RiskListRow;
  flags: RiskListFlags;
}

function matchesFilter(filter: string | undefined, flags: RiskListFlags): boolean {
  if (filter === "needs-attention") return flags.notEstablished || flags.reviewDue;
  if (filter === "capacity-constrained") return flags.capacityConstrained;
  return true;
}

export async function RiskContent({
  searchParams,
}: {
  searchParams: Promise<{
    /** Admin book-switcher: narrow the list to one advisor's book. */
    advisor?: string;
    filter?: string;
  }>;
}) {
  const params = await searchParams;
  const { orgRole } = await auth();
  const canManage = orgRole === "org:admin";

  const rows = await listRiskProfiles({ viewAsAdvisorId: params.advisor });
  const now = new Date();
  const allRows: RiskDisplayRow[] = rows.map((row) => ({
    row,
    flags: deriveListFlags(row, now),
  }));
  const visibleRows = allRows.filter(({ flags }) => matchesFilter(params.filter, flags));

  const tab = "text-sm text-ink-3 hover:text-ink";
  const tabActive = "text-sm font-medium text-ink";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Risk</h1>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-4">
          <Link href="/risk" className={!params.filter ? tabActive : tab}>
            All
          </Link>
          <Link
            href="/risk?filter=needs-attention"
            className={params.filter === "needs-attention" ? tabActive : tab}
          >
            Needs attention
          </Link>
          <Link
            href="/risk?filter=capacity-constrained"
            className={params.filter === "capacity-constrained" ? tabActive : tab}
          >
            Capacity-constrained
          </Link>
        </div>
        {canManage && <BookSwitcher />}
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No households yet." />
      ) : visibleRows.length === 0 ? (
        <EmptyState message="No households match this filter." />
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
          <table className="min-w-full divide-y divide-hair">
            <thead className="bg-card-2">
              <tr>
                <th className={TH}>Household</th>
                <th className={TH}>Profile</th>
                <th className={TH}>Binding</th>
                <th className={TH}>Tolerance</th>
                <th className={TH}>Capacity</th>
                <th className={TH}>Environment</th>
                <th className={TH}>Last updated</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {visibleRows.map(({ row, flags }) => (
                <tr key={row.clientId} className="hover:bg-card-2">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      href={`/risk/${row.clientId}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {row.householdName}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <RiskLevelBadge level={row.compositeLevel} score={row.compositeScore} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                    {bindingLabel(row.bindingConstraint)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {row.toleranceScore === null ? (
                      DASH
                    ) : (
                      <>
                        <span className="tabular text-ink">{row.toleranceScore}</span>
                        <span className="mt-0.5 block text-xs text-ink-3">
                          {TOLERANCE_SOURCE_LABELS[row.toleranceSource ?? ""] ?? "—"}
                          {" · "}
                          {formatDate(row.toleranceConfirmedAt)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    {flags.capacityPending ? (
                      <span className="text-ink-3">Pending — no plan</span>
                    ) : (
                      <span className="tabular text-ink">{row.capacityScore}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                    {formatEnvironment(row.environmentAdj)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-3">
                    {formatDate(row.updatedAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <RiskStatusChips flags={flags} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <div className="px-6 py-12 text-center">
        <p className="text-ink-3">{message}</p>
      </div>
    </div>
  );
}
