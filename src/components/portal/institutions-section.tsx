import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { REAUTH_CODES, REVOKED_CODES } from "@/lib/plaid/errors";
import { InstitutionRow } from "./institution-row";

function formatRelative(d: Date | null): string {
  if (!d) return "never";
  const hours = Math.round((Date.now() - d.getTime()) / 3600_000);
  if (hours < 1) return "Last refreshed just now";
  if (hours === 1) return "Last refreshed 1h ago";
  return `Last refreshed ${hours}h ago`;
}

export async function InstitutionsSection({
  clientId,
  editEnabled,
}: {
  clientId: string;
  editEnabled: boolean;
}) {
  const items = await db
    .select({
      id: plaidItems.id,
      institutionName: plaidItems.institutionName,
      lastRefreshedAt: plaidItems.lastRefreshedAt,
      lastRefreshError: plaidItems.lastRefreshError,
      transactionsCursor: plaidItems.transactionsCursor,
      newAccountsAvailableAt: plaidItems.newAccountsAvailableAt,
    })
    .from(plaidItems)
    .where(eq(plaidItems.clientId, clientId))
    .orderBy(plaidItems.createdAt);

  if (items.length === 0) return null;

  return (
    <section
      aria-labelledby="institutions-title"
      className="max-w-3xl space-y-5 p-5"
    >
      <header>
        <h2
          id="institutions-title"
          className="text-[18px] font-semibold text-ink"
        >
          Linked Institutions
        </h2>
      </header>
      <ul className="divide-y divide-hair rounded-lg border border-hair">
        {items.map((it) => {
          const revoked =
            it.lastRefreshError != null && REVOKED_CODES.has(it.lastRefreshError);
          const needsReauth =
            !revoked &&
            it.lastRefreshError != null &&
            REAUTH_CODES.has(it.lastRefreshError);
          return (
            <InstitutionRow
              key={it.id}
              itemId={it.id}
              institutionName={it.institutionName ?? "Unknown institution"}
              statusLabel={
                revoked
                  ? "Access revoked"
                  : needsReauth
                    ? "Re-auth required"
                    : formatRelative(it.lastRefreshedAt)
              }
              needsReauth={needsReauth}
              revoked={revoked}
              newAccountsAvailable={it.newAccountsAvailableAt != null}
              editEnabled={editEnabled}
              needsTransactionsConsent={it.transactionsCursor == null}
            />
          );
        })}
      </ul>
    </section>
  );
}
