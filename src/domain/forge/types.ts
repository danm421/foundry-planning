// src/domain/forge/types.ts

/** A single proposed write, rendered on the approval card. Matches the SSE contract. */
export type WritePreview = {
  summary: string;
  name: string;
  details?: string[];
};
