import type { CoverPageOptions } from "@/lib/presentations/types";

export function summarizeCoverOptions(opts: CoverPageOptions): string {
  return opts.title.trim() ? `Title: ${opts.title.trim()}` : "Default cover";
}
