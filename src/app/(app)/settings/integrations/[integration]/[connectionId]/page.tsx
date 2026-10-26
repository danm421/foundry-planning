import type { ReactElement } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { listOpenReviews } from "@/lib/integrations/reviews";
import { decodeAddeparConfig } from "@/lib/integrations/providers/addepar/credentials";
import { getProvider, isProviderId } from "@/lib/integrations/registry";
import { INTEGRATION_INFO } from "@/lib/integrations/catalog";
import { IntegrationConnectionCard } from "@/components/IntegrationConnectionCard";
import { IntegrationHouseholdLinkTable } from "@/components/IntegrationHouseholdLinkTable";
import { IntegrationPendingReviews } from "@/components/IntegrationPendingReviews";
import { ArrowLeftIcon } from "@/components/icons";
import Forbidden from "../../../forbidden";

interface Props {
  params: Promise<{ integration: string; connectionId: string }>;
}

/** One of the caller's own connections: its status, sync, reviews and household links. */
export default async function IntegrationConnectionPage({ params }: Props): Promise<ReactElement> {
  const { orgId: firmId, userId } = await auth();
  if (!firmId || !userId) return <Forbidden requiredRole="firm member" />;

  const { integration: slug, connectionId } = await params;
  if (!isProviderId(slug)) notFound();
  const provider = getProvider(slug);
  if (!provider.syncs || !provider.isEnabled()) notFound();

  // A colleague's connection, another firm's, or an id that doesn't exist all
  // read the same: not found.
  const connection = await getOwnedConnection({ connectionId, firmId, userId });
  if (!connection || connection.providerId !== provider.id) notFound();

  const name = connection.name ?? provider.label;
  const info = INTEGRATION_INFO[provider.id];
  // Open reviews are stored rows; listing them needs no credentials, so they
  // show whatever the connection's status.
  const reviews = await listOpenReviews(connection.id);
  // The address and firm ID are not secret (the config stays after a disconnect),
  // so a reconnect form can start from them. Never the key or secret.
  let config: { apiBase: string; addeparFirmId: string } | null = null;
  if (provider.id === "addepar") {
    try {
      config = decodeAddeparConfig(connection.scope);
    } catch {
      config = null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href={`/settings/integrations/${provider.id}`}
          className="mb-2 inline-flex w-fit items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
        >
          <ArrowLeftIcon width={14} height={14} />
          {provider.label}
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
          {info.category}
        </span>
        <h1 className="text-base font-medium text-ink">{name}</h1>
      </header>
      <IntegrationConnectionCard
        providerId={provider.id}
        connectionId={connection.id}
        name={name}
        label={provider.label}
        authKind={provider.authKind}
        status={connection.status}
        lastSyncedAt={connection.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null}
        lastSyncError={connection.lastSyncError}
        apiBase={config?.apiBase}
        addeparFirmId={config?.addeparFirmId}
      />
      <IntegrationPendingReviews label={provider.label} reviews={reviews} />
      {connection.status !== "disconnected" ? (
        <IntegrationHouseholdLinkTable
          providerId={provider.id}
          connectionId={connection.id}
          label={provider.label}
        />
      ) : null}
    </div>
  );
}
