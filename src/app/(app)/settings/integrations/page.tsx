import type { ReactElement } from "react";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { getConnection } from "@/lib/integrations/connections";
import { listProviders } from "@/lib/integrations/registry";
import {
  INTEGRATION_INFO,
  PLAID_LABEL,
  providerState,
  sortIntegrations,
  type IntegrationSlug,
  type IntegrationState,
} from "@/lib/integrations/catalog";
import { getPlaidUsage } from "@/lib/integrations/plaid-usage";
import { isAzureOpenAiEnabled } from "@/lib/integrations/providers/azure-openai/flag";
import { ChevronRightIcon } from "@/components/icons";
import Forbidden from "../forbidden";

type Row = {
  slug: IntegrationSlug;
  label: string;
  state: IntegrationState;
  /** One fact under the status — a date or a count, so it renders mono. */
  detail: { label: string; value: string } | null;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function IntegrationsPage(): Promise<ReactElement> {
  try {
    await requireOrgAdminOrOwner();
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden requiredRole="admin or owner" />;
    throw err;
  }

  const { orgId: firmId } = await auth();
  if (!firmId) return <Forbidden requiredRole="admin or owner" />;

  // Azure OpenAI's kill-switch hides it entirely — no row, and no connection
  // read either: a row built from a fetched-anyway connection is a kill-switch
  // that only hides the UI.
  const providers = listProviders().filter(
    (p) => p.id !== "azure_openai" || isAzureOpenAiEnabled(),
  );
  const [providerRows, plaid] = await Promise.all([
    Promise.all(
      providers.map(async (p): Promise<Row> => {
        const conn = await getConnection(firmId, p.id);
        const state = providerState(p.isEnabled(), conn);
        const synced = p.syncs && state === "connected" && conn?.lastSyncedAt;
        return {
          slug: p.id,
          label: p.label,
          state,
          detail: synced ? { label: "Last synced", value: formatDate(synced) } : null,
        };
      }),
    ),
    getPlaidUsage(firmId),
  ]);

  const rows = sortIntegrations<Row>([
    ...providerRows,
    {
      slug: "plaid",
      label: PLAID_LABEL,
      state: plaid.clientCount > 0 ? "connected" : "available",
      detail:
        plaid.clientCount > 0
          ? { label: "Clients linked", value: String(plaid.clientCount) }
          : null,
    },
  ]);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "In use",
      rows: rows.filter((r) => r.state === "attention" || r.state === "connected"),
    },
    { title: "Available", rows: rows.filter((r) => r.state === "available") },
    { title: "Coming soon", rows: rows.filter((r) => r.state === "coming_soon") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Integrations</h1>
        <p className="text-sm text-ink-3">
          The services Foundry Planning connects to. Open one to set it up or manage it.
        </p>
      </header>

      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
              {g.title}
            </h2>
            <ul className="divide-y divide-hair overflow-hidden rounded border border-hair bg-card">
              {g.rows.map((r) => (
                <li key={r.slug}>
                  <IntegrationRow row={r} />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

const STATUS: Record<Exclude<IntegrationState, "coming_soon">, { dot: string; label: string }> = {
  attention: { dot: "bg-warn", label: "Reconnect needed" },
  connected: { dot: "bg-good", label: "Connected" },
  available: { dot: "bg-ink-4", label: "Not connected" },
};

function IntegrationRow({ row }: { row: Row }): ReactElement {
  const info = INTEGRATION_INFO[row.slug];
  // Text and status side by side from `sm` up; stacked on a phone, where a
  // status column beside the text squeezes the description to a word a line.
  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-ink">{row.label}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
            {info.category}
          </span>
        </div>
        <p className="text-sm text-ink-3">{info.blurb}</p>
      </div>
      {row.state === "coming_soon" ? (
        <span className="w-fit shrink-0 rounded-full bg-card-2 px-2 py-0.5 text-xs text-ink-3">
          Coming soon
        </span>
      ) : (
        <div className="flex shrink-0 flex-col gap-0.5 sm:items-end">
          <span className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className={`h-2 w-2 rounded-full ${STATUS[row.state].dot}`} aria-hidden="true" />
            {STATUS[row.state].label}
          </span>
          {row.detail ? (
            <span className="text-xs text-ink-3">
              {row.detail.label} <span className="tabular">{row.detail.value}</span>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );

  // Nothing to set up or manage yet, so no page to open.
  if (row.state === "coming_soon") {
    return <div className="flex items-center gap-4 px-4 py-3">{body}</div>;
  }

  return (
    <Link
      href={`/settings/integrations/${row.slug}`}
      className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      {body}
      <ChevronRightIcon
        width={16}
        height={16}
        className="shrink-0 text-ink-4 transition-colors group-hover:text-ink"
        aria-hidden="true"
      />
    </Link>
  );
}
