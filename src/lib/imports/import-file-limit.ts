// src/lib/imports/import-file-limit.ts
/**
 * Per-file cap for an import, whichever door the file comes in by. A leaf, so
 * the browser's upload zone checks it before uploading.
 */
export const MAX_IMPORT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
