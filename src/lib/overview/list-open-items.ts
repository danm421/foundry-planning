import { db } from "@/db";
import { clientOpenItems, clients } from "@/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

type Options = {
  open?: boolean; // true → WHERE completedAt IS NULL
  limit?: number; // default 50
};

export async function listOpenItems(
  clientId: string,
  firmId: string,
  opts: Options = {},
) {
  const { open, limit = 50 } = opts;

  // priority ordering: high > medium > low
  const priorityRank = sql<number>`
    CASE ${clientOpenItems.priority}
      WHEN 'high' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'low' THEN 1
    END
  `;

  const conditions = [
    eq(clientOpenItems.clientId, clientId),
    eq(clients.firmId, firmId),
    ...(open ? [isNull(clientOpenItems.completedAt)] : []),
  ];

  return db
    .select({
      id: clientOpenItems.id,
      clientId: clientOpenItems.clientId,
      title: clientOpenItems.title,
      priority: clientOpenItems.priority,
      dueDate: clientOpenItems.dueDate,
      completedAt: clientOpenItems.completedAt,
      createdAt: clientOpenItems.createdAt,
      updatedAt: clientOpenItems.updatedAt,
    })
    .from(clientOpenItems)
    .innerJoin(clients, eq(clients.id, clientOpenItems.clientId))
    .where(and(...conditions))
    .orderBy(
      desc(priorityRank),
      asc(clientOpenItems.dueDate),
      desc(clientOpenItems.createdAt),
    )
    .limit(limit);
}

export type OpenItemRow = Awaited<ReturnType<typeof listOpenItems>>[number];
