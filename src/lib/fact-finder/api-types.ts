// src/lib/fact-finder/api-types.ts
// Request and response shapes of the fact finder routes, shared by the routes
// and the screen. Client-safe: types and copy only.
import type { ClientOp } from "./ops";
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
  message: string;
}
/** `turnId` is the reply's assistant turn id when it changed something (its Undo), else null. */
export interface TurnResponse {
  factFinder: FactFinderState;
  turnId: string | null;
}

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

export const READ_BUSY_MESSAGE = "Already reading these documents — wait for that to finish.";
export const TURN_BUSY_MESSAGE = "Still reading your documents — wait for that to finish, then ask again.";
export const REVIEW_READING_MESSAGE = "Wait for the documents to finish reading, then review.";
export const REVIEW_STALE_MESSAGE = "The fact finder changed while reviewing — review again.";
