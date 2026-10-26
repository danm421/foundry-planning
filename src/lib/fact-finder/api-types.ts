// src/lib/fact-finder/api-types.ts
// Request and response shapes of the fact finder routes, shared by the routes
// and the screen. Client-safe: types and copy only.
import type { ClientOp } from "./ops";
import type { ChangeTicks } from "./change-set";
import type { FactFinderState, FFReader } from "./types";

/** GET …/fact-finder */
export interface GetFactFinderResponse {
  factFinder: FactFinderState;
}

/** PATCH …/fact-finder */
export interface PatchFactFinderBody {
  baseVersion: number;
  ops: ClientOp[];
}
export interface PatchFactFinderResponse {
  version: number;
  factFinder: FactFinderState;
}

/** 409 from PATCH: the fact finder moved on since `baseVersion`. */
export interface ConflictResponse {
  error: "conflict";
  factFinder: FactFinderState;
}

/** Every other refusal. `error` is written for the advisor. */
export interface ErrorResponse {
  error: string;
}

/** POST …/fact-finder/turn */
export interface TurnBody {
  /** Required in "advisor" mode (the default); "compose" folds newly read documents into the worksheet. */
  message?: string;
  mode?: "advisor" | "compose";
}
/** `turnId` is the reply's assistant turn id when it changed something (its Undo), else null. */
export interface TurnResponse {
  factFinder: FactFinderState;
  turnId: string | null;
}

/** One SSE frame of the turn stream: a tool line, the finished reply, or the error that ended it. */
export type TurnFrame =
  | { type: "progress"; line: string }
  | { type: "done"; factFinder: FactFinderState; turnId: string | null }
  | { type: "error"; message: string; factFinder?: FactFinderState };

/** POST …/fact-finder/undo */
export interface UndoBody {
  turnId: string;
}
export interface UndoResponse {
  factFinder: FactFinderState;
}

/** One progress event of POST …/fact-finder/read. */
export type ReadEvent =
  | {
      type: "file";
      fileId: string;
      fileName: string;
      status: "reading" | "done" | "failed";
      reader?: FFReader;
      rows?: number;
      error?: string;
    }
  | { type: "done"; summary: string; caveats: string[]; version: number };

/** One SSE frame of the read stream: an event, or the error that ended it. */
export type ReadFrame = ReadEvent | { type: "error"; message: string };

/** POST …/fact-finder/review body (optional): review only these rows; none = every row. */
export interface ReviewBody {
  rowIds?: string[];
}
/** POST …/fact-finder/review: the fact finder with its new `changeSet`. */
export interface ReviewResponse {
  factFinder: FactFinderState;
}
/** 409 from review: why it didn't run. `factFinder` when the route changed it (dropped links); `rows` = the rows to check. */
export interface ReviewRefusal {
  error: string;
  factFinder?: FactFinderState;
  rows?: string[];
}

/** POST …/fact-finder/save: the advisor's ticks on the change list built at `changeSetVersion`. */
export interface SaveBody {
  changeSetVersion: number;
  ticks: ChangeTicks;
}
/** 200 from save: the fact finder, closed. */
export interface SaveResponse {
  factFinder: FactFinderState;
}
/**
 * 409 (stale change list, household or record, already saved, nothing to save), 422 (`lineId`: the line the save
 * can't write) and 500 (`lineId` when the save failed at a line) from save. `factFinder` when the route has a
 * fresher one to show.
 */
export interface SaveRefusal {
  error: string;
  lineId?: string;
  factFinder?: FactFinderState;
}

export const READ_BUSY_MESSAGE = "Already reading these documents — wait for that to finish.";
export const TURN_BUSY_MESSAGE = "Still reading your documents — wait for that to finish, then ask again.";
export const REVIEW_READING_MESSAGE = "Wait for the documents to finish reading, then review.";
export const REVIEW_STALE_MESSAGE = "The fact finder changed while reviewing — review again.";
export const SAVE_STALE_MESSAGE = "The fact finder changed since you reviewed — review again.";
export const SAVE_CLOSED_MESSAGE = "This import is saved to the plan — start a new import to change it.";
export const SAVE_RACE_MESSAGE = "Something on the plan changed while saving — review again.";
export const SAVE_FAILED_MESSAGE = "The save failed — nothing was changed.";
export const SAVE_HOUSEHOLD_MESSAGE = "The household changed since you reviewed — review again.";
export const SAVE_NOTHING_MESSAGE = "There's nothing to save — every row is unticked or left out.";
export const SAVE_READING_MESSAGE = "Wait for the documents to finish reading, then review again.";
