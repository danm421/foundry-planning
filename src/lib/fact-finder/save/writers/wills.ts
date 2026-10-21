// src/lib/fact-finder/save/writers/wills.ts
/**
 * The wills writers (Plan 4, D4). A will line creates the will (its grantor is
 * all it holds); a provision line adds one provision after the will's own, or
 * changes one in place; a remaining-estate line replaces the will's primary
 * tier. None replaces the will's other provisions or its contingent recipients
 * (R1's third defect), and a will already on the plan is never updated — the
 * import changes only what hangs off it. Every write runs on the save's
 * transaction.
 */
import { and, eq } from "drizzle-orm";
import { willBequestRecipients, willResiduaryRecipients } from "@/db/schema";
import type { EntityWriteResult } from "@/lib/clients/entity-write-result";
import {
  addWillBequestForClient,
  createWillForClient,
  replaceWillResiduaryForClient,
  updateWillBequestForClient,
} from "@/lib/clients/wills-writes";
import { coreArgs, SaveLineError, unwrap, type SaveContext, type SaveInput, type SaveWriter } from "../types";

/** The wills routes' refusal codes, as the advisor reads them. */
const PLAIN: Record<string, string> = {
  duplicate_liability_bequest: "This will already has a provision for this debt — one per debt.",
  liability_not_found: "The debt it leaves isn't on the plan.",
  liability_linked_not_bequestable: "A debt tied to a property goes with the property — a will can't leave it on its own.",
  liability_entity_owned_not_bequestable: "A debt a trust or business owns can't be left by a will.",
};

/** The id of what the core wrote, or a SaveLineError — in plain words for a refusal code. */
function idOf<T>(result: EntityWriteResult<T>): string {
  if (!result.ok && Object.hasOwn(PLAIN, result.error)) throw new SaveLineError(PLAIN[result.error]);
  return unwrap(result).resourceId;
}

/** The will a provision or the remaining estate hangs off: the line's parent, resolved. */
function willOf(input: SaveInput): string {
  if (input.parentId !== null) return input.parentId;
  throw new SaveLineError(input.line.target === "will_residuary_recipient" ? "This remaining estate names no will." : "This provision names no will.");
}

/** The record book leaves Other Heirs out of a will's recipients, so a write that replaces them would drop it. */
const OTHER_HEIRS_ON_RECORD = "This will leaves a share to Other Heirs, which can only be changed in the app.";

async function refuseOtherHeirsBequest(ctx: SaveContext, bequestId: string): Promise<void> {
  const [row] = await ctx.tx
    .select({ id: willBequestRecipients.id })
    .from(willBequestRecipients)
    .where(and(eq(willBequestRecipients.bequestId, bequestId), eq(willBequestRecipients.recipientKind, "other_heirs")))
    .limit(1);
  if (row) throw new SaveLineError(OTHER_HEIRS_ON_RECORD);
}

async function refuseOtherHeirsResiduary(ctx: SaveContext, willId: string): Promise<void> {
  const [row] = await ctx.tx
    .select({ id: willResiduaryRecipients.id })
    .from(willResiduaryRecipients)
    .where(
      and(
        eq(willResiduaryRecipients.willId, willId),
        eq(willResiduaryRecipients.tier, "primary"),
        eq(willResiduaryRecipients.recipientKind, "other_heirs"),
      ),
    )
    .limit(1);
  if (row) throw new SaveLineError(OTHER_HEIRS_ON_RECORD);
}

/** The remaining estate as the wills routes take it. */
const residuaryOf = (input: SaveInput) => ({ residuaryRecipients: input.body.recipients });

/** Replace the will's remaining estate (its primary tier); the set's id is its will's. */
async function writeResiduary(ctx: SaveContext, input: SaveInput): Promise<string> {
  const willId = willOf(input);
  await refuseOtherHeirsResiduary(ctx, willId);
  return idOf(await replaceWillResiduaryForClient({ ...coreArgs(ctx), willId, input: residuaryOf(input) }));
}

export const WILL_WRITERS: { will: SaveWriter; will_bequest: SaveWriter; will_residuary_recipient: SaveWriter } = {
  will: {
    create: async (ctx, input) => idOf(await createWillForClient({ ...coreArgs(ctx), input: input.body })),
    update: async () => {
      throw new SaveLineError("The import doesn't change a will on the plan — only its provisions and remaining estate.");
    },
  },
  will_bequest: {
    create: async (ctx, input) => idOf(await addWillBequestForClient({ ...coreArgs(ctx), willId: willOf(input), input: input.body })),
    update: async (ctx, input) => {
      if (input.recordId === null) throw new SaveLineError("This provision isn't on the plan.");
      // Only a line that sends recipients replaces them; any other change keeps Other Heirs.
      if ("recipients" in input.body) await refuseOtherHeirsBequest(ctx, input.recordId);
      idOf(await updateWillBequestForClient({ ...coreArgs(ctx), willId: willOf(input), bequestId: input.recordId, input: input.body }));
    },
  },
  // A set: its id is its will's.
  will_residuary_recipient: {
    create: writeResiduary,
    update: async (ctx, input) => {
      await writeResiduary(ctx, input);
    },
  },
};
