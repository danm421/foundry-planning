// src/lib/fact-finder/save/writers/notes-receivable.ts
/**
 * The note-receivable save writer: the Details write path
 * (notes-receivable-writes.ts) on the save's transaction. The line's request
 * body goes through as it is — its owners (a person, a trust or a charity, each
 * with its share) are what the core checks and writes.
 */
import { createNoteReceivableForClient, updateNoteReceivableForClient } from "@/lib/clients/notes-receivable-writes";
import { SaveLineError, unwrap, type SaveWriter } from "../types";

const note_receivable: SaveWriter = {
  async create(ctx, input) {
    const { resourceId } = unwrap(
      await createNoteReceivableForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, input: input.body, tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
    return resourceId;
  },
  async update(ctx, input) {
    if (!input.recordId) throw new SaveLineError("The note to change isn't on the plan.");
    unwrap(
      await updateNoteReceivableForClient({
        clientId: ctx.clientId, firmId: ctx.firmId, actorId: ctx.actorId, noteId: input.recordId, input: input.body,
        tx: ctx.tx, afterCommit: ctx.afterCommit,
      }),
    );
  },
};

export const NOTE_WRITERS: { note_receivable: SaveWriter } = { note_receivable };
