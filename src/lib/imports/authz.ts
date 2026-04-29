import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clientImports, clients } from "@/db/schema";
import { UnauthorizedError } from "@/lib/db-helpers";

/**
 * Authorization helpers for the import tool v2. Centralizes the
 * "is the caller allowed to touch this import?" check so route
 * handlers don't each reinvent the firm/client/owner triad and risk
 * leaving a leg out.
 *
 * The helper throws tagged errors instead of returning a discriminated
 * union — handlers map them to HTTP status codes in their try/catch.
 */

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

// Re-export so callers can wire one import for the full error taxonomy.
export { UnauthorizedError };

/**
 * Verify (a) the client belongs to the caller's firm, (b) the import
 * belongs to that client, (c) the import is not discarded, and
 * (d) the caller is the import's creator (advisor-bound; paraplanner
 * sharing is future work).
 *
 * Returns the import row on success. Throws NotFoundError when the
 * import or its client cannot be found in the firm scope (also when
 * the import is soft-deleted via discardedAt); ForbiddenError when
 * found but owned by a different user.
 *
 * The "discarded => 404" treatment is deliberate: a re-loaded handoff
 * URL after discard should look indistinguishable from a never-existed
 * id, both to advisors and to anyone fishing for valid import ids.
 */
export async function requireImportAccess(args: {
  importId: string;
  clientId: string;
  firmId: string;
  userId: string;
}) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, args.clientId), eq(clients.firmId, args.firmId)));
  if (!client) throw new NotFoundError("Client not found");

  const [imp] = await db
    .select()
    .from(clientImports)
    .where(
      and(
        eq(clientImports.id, args.importId),
        eq(clientImports.clientId, args.clientId),
        eq(clientImports.orgId, args.firmId),
        isNull(clientImports.discardedAt),
      ),
    );
  if (!imp) throw new NotFoundError("Import not found");
  if (imp.createdByUserId !== args.userId) {
    throw new ForbiddenError("Import not owned by current user");
  }
  return imp;
}
