// External beneficiary write-core (charities and outside individuals). The POST and
// PATCH route bodies, lifted verbatim so the fact finder save can write them on its
// transaction. No audit row (the routes write none), so no firm or actor is taken.
import { externalBeneficiaries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import { externalBeneficiaryCreateSchema, externalBeneficiaryUpdateSchema } from "@/lib/schemas/beneficiaries";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ExternalBeneficiaryRow = typeof externalBeneficiaries.$inferSelect;

function invalidBody(error: Parameters<typeof formatZodIssues>[0]) {
  const issues = formatZodIssues(error);
  return writeError(400, "Invalid body", { error: "Invalid body", issues });
}

export async function createExternalBeneficiaryForClient(
  args: { clientId: string; input: unknown } & WriteOptions,
): Promise<EntityWriteResult<ExternalBeneficiaryRow>> {
  const parsed = externalBeneficiaryCreateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const [row] = await handleOf(args)
    .insert(externalBeneficiaries)
    .values({
      clientId: args.clientId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      charityType: parsed.data.charityType,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  return { ok: true, data: row, resourceId: row.id };
}

export async function updateExternalBeneficiaryForClient(
  args: { clientId: string; beneficiaryId: string; input: unknown } & WriteOptions,
): Promise<EntityWriteResult<ExternalBeneficiaryRow>> {
  const parsed = externalBeneficiaryUpdateSchema.safeParse(args.input);
  if (!parsed.success) return invalidBody(parsed.error);
  const [row] = await handleOf(args)
    .update(externalBeneficiaries)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(externalBeneficiaries.id, args.beneficiaryId),
        eq(externalBeneficiaries.clientId, args.clientId),
      ),
    )
    .returning();
  if (!row) return writeError(404, "Not found");
  return { ok: true, data: row, resourceId: row.id };
}
