import type { ReactElement } from "react";
import Link from "next/link";

type Props = { clientCount: number; institutionCount: number };

/**
 * Read-only. Plaid is client-scoped (each client links their own institutions
 * from the portal) so there is nothing firm-level to configure — this tile
 * exists so the hub answers "where does that data come from?" without cloning
 * the per-client management UI.
 */
export function PlaidIntegrationTile({ clientCount, institutionCount }: Props): ReactElement {
  return (
    <div className="rounded-lg border border-hair p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Plaid</h2>
        <span className="rounded-full bg-card-2 px-2 py-0.5 text-xs text-ink-3">
          Client-linked
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {clientCount} {clientCount === 1 ? "client" : "clients"} connected ·{" "}
        {institutionCount} {institutionCount === 1 ? "institution" : "institutions"}
      </p>
      <p className="mt-2 text-sm text-ink-3">
        Managed per client from the client&rsquo;s Accounts page.{" "}
        <Link href="/clients" className="underline">
          View clients
        </Link>
      </p>
    </div>
  );
}
