import { cache } from "react";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Whether org:member advisors are siloed to their own book in this firm.
 * Missing firm row → false (legacy firm-wide visibility). React-cached so the
 * repeated calls inside a single request (visibility + list + gate) hit the DB once.
 */
export const firmBookSiloEnabled = cache(async (firmId: string): Promise<boolean> => {
  const row = await db.query.firms.findFirst({
    where: eq(firms.firmId, firmId),
    columns: { bookSiloEnabled: true },
  });
  return row?.bookSiloEnabled ?? false;
});
