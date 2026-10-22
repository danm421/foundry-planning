// src/lib/integrations/connection-access.ts
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { toConnectionRow, type IntegrationConnectionRow } from "./connections";

const connectionIdSchema = z.uuid();

/**
 * The one ownership gate for every route that names a connection. Returns the
 * connection only when the caller owns it in their own firm; anything else
 * (a colleague's id, another firm's, an unknown or malformed id) is null, so
 * the route answers 404 and a connection id can't be probed.
 *
 * Ownership is part of the query, so a colleague's credentials are never
 * loaded or decrypted. A non-UUID id returns before querying: Postgres would
 * reject it as a uuid and turn a probe into a 500.
 */
export async function getOwnedConnection(input: {
  connectionId: string;
  firmId: string;
  userId: string;
}): Promise<IntegrationConnectionRow | null> {
  if (!connectionIdSchema.safeParse(input.connectionId).success) return null;
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, input.connectionId),
        eq(integrationConnections.firmId, input.firmId),
        eq(integrationConnections.ownerUserId, input.userId),
      ),
    )
    .limit(1);
  return row ? toConnectionRow(row) : null;
}
