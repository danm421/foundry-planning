// src/lib/fact-finder/save/writers/notes-receivable.ts
/**
 * The note-receivable save writer: the Details write path
 * (notes-receivable-writes.ts) on the save's transaction. The line's request
 * body goes through as it is — its owners (a person, a trust or a charity, each
 * with its share) are what the core checks and writes.
 */
import { createNoteReceivableForClient, updateNoteReceivableForClient } from "@/lib/clients/notes-receivable-writes";
import { coreArgs, recordIdOf, unwrap, type SaveWriter } from "../types";

const note_receivable: SaveWriter = {
  async create(ctx, input) {
    return unwrap(await createNoteReceivableForClient({ ...coreArgs(ctx), input: input.body })).resourceId;
  },
  async update(ctx, input) {
    const noteId = recordIdOf(input, "The note to change isn't on the plan.");
    unwrap(await updateNoteReceivableForClient({ ...coreArgs(ctx), noteId, input: input.body }));
  },
};

export const NOTE_WRITERS: { note_receivable: SaveWriter } = { note_receivable };
