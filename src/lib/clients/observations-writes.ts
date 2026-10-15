// Plan note (observation / next step) write-core. The POST and PATCH [id] route
// bodies, lifted verbatim so the fact finder save can write them on its
// transaction: with `tx`, the next sort order is read on it, so several notes
// created in one save get 0, 1, 2… rather than all reading the same maximum.
import { planObservations } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { handleOf, type WriteOptions } from "@/lib/db-tx";
import { formatZodIssues } from "@/lib/schemas/common";
import { observationCreateSchema, observationUpdateSchema } from "@/lib/schemas/observations";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type ObservationRow = typeof planObservations.$inferSelect;

function validationFailed(error: Parameters<typeof formatZodIssues>[0]) {
  return writeError(400, "Validation failed", { error: "Validation failed", issues: formatZodIssues(error) });
}

export async function createObservationForClient(
  args: {
    clientId: string;
    firmId: string;
    /** Absent: the audit row names the signed-in user, as the route always has. */
    actorId?: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<ObservationRow>> {
  const parsed = observationCreateSchema.safeParse(args.input);
  if (!parsed.success) return validationFailed(parsed.error);
  const handle = handleOf(args);

  // sortOrder = current max within (clientId, section) + 1, or 0 when empty.
  const [top] = await handle
    .select({ sortOrder: planObservations.sortOrder })
    .from(planObservations)
    .where(
      and(
        eq(planObservations.clientId, args.clientId),
        eq(planObservations.section, parsed.data.section),
      ),
    )
    .orderBy(desc(planObservations.sortOrder))
    .limit(1);
  const nextSortOrder = top ? top.sortOrder + 1 : 0;

  const [row] = await handle
    .insert(planObservations)
    .values({
      clientId: args.clientId,
      section: parsed.data.section,
      source: parsed.data.source,
      topic: parsed.data.topic,
      title: parsed.data.title ?? null,
      body: parsed.data.body,
      owner: parsed.data.owner ?? null,
      priority: parsed.data.priority ?? null,
      targetDate: parsed.data.targetDate ?? null,
      audience: parsed.data.audience,
      sourceScenarioId: parsed.data.sourceScenarioId ?? null,
      sortOrder: nextSortOrder,
    })
    .returning();

  await recordAudit({
    action: "plan_observation.create",
    resourceType: "plan_observation",
    resourceId: row.id,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId,
    metadata: { section: row.section, topic: row.topic, audience: row.audience, ...args.crossFirmMeta },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: row.id };
}

export async function updateObservationForClient(
  args: {
    clientId: string;
    firmId: string;
    actorId?: string;
    observationId: string;
    input: unknown;
    crossFirmMeta?: Record<string, unknown>;
  } & WriteOptions,
): Promise<EntityWriteResult<ObservationRow>> {
  const parsed = observationUpdateSchema.safeParse(args.input);
  if (!parsed.success) return validationFailed(parsed.error);
  const handle = handleOf(args);

  const [existing] = await handle
    .select({ status: planObservations.status })
    .from(planObservations)
    .where(
      and(
        eq(planObservations.id, args.observationId),
        eq(planObservations.clientId, args.clientId),
      ),
    );

  if (!existing) return writeError(404, "Observation not found");

  // status -> "done" sets completedAt; leaving "done" for any other status
  // clears it. Untouched status (undefined) leaves completedAt as-is.
  const willBeDone = parsed.data.status === "done";
  const leavingDone =
    existing.status === "done" &&
    parsed.data.status !== undefined &&
    parsed.data.status !== "done";

  const [row] = await handle
    .update(planObservations)
    .set({
      ...(parsed.data.topic !== undefined && { topic: parsed.data.topic }),
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      ...(parsed.data.body !== undefined && { body: parsed.data.body }),
      ...(parsed.data.owner !== undefined && { owner: parsed.data.owner }),
      ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
      ...(parsed.data.targetDate !== undefined && { targetDate: parsed.data.targetDate }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(willBeDone && { completedAt: new Date() }),
      ...(leavingDone && { completedAt: null }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(planObservations.id, args.observationId),
        eq(planObservations.clientId, args.clientId),
      ),
    )
    .returning();

  if (!row) return writeError(404, "Observation not found");

  await recordAudit({
    action: willBeDone ? "plan_observation.complete" : "plan_observation.update",
    resourceType: "plan_observation",
    resourceId: row.id,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId,
    metadata: { ...args.crossFirmMeta },
    tx: args.tx,
  });

  return { ok: true, data: row, resourceId: row.id };
}
