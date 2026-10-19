// src/lib/fact-finder/readers/read-error.ts
/**
 * A file couldn't be read, said in words the screen and the chat can show.
 * Any other error a read meets is shown as a fixed line, its detail logged.
 */
export class FileReadError extends Error {
  override name = "FileReadError";
}
