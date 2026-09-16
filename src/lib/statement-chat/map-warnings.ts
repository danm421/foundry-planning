/**
 * Fold the map pass's per-file notices into one line per KIND.
 *
 * The pass runs once per uploaded file and every file speaks for itself, so a
 * 27-file import produced 27-odd lines — fifteen of them the same sentence
 * about SSN redaction, differing only in a count nobody reads. The two facts
 * an advisor actually needs out of that card ("seven documents could not be
 * read", "two were scanned and only partly read") were buried in the middle
 * of it.
 *
 * Grouping is by the message TEXT, which is why the route no longer names the
 * file inside its own errors — the file name is carried alongside instead, so
 * two files that hit the same problem produce one line naming both.
 */

import { joinWithAnd } from "./narrate";

export interface MapWarning {
  /**
   * What the notice is about: the name the advisor uploaded the file under,
   * or — for a notice raised while committing — the entity's own label.
   */
  source: string;
  message: string;
}

/**
 * The redaction notice is the one line worth summing rather than listing: it
 * reports a count per file, the counts mean nothing individually, and it fires
 * on most documents in a real import.
 */
const REDACTION = /^Redacted (\d+) SSN-like value\(s\) from this document before sending it to the AI extractor\.$/;

/** How many file names a line prints before it starts counting instead. */
const MAX_NAMED = 3;

function documents(count: number): string {
  return count === 1 ? "1 document" : `${count} documents`;
}

/** "a.pdf, b.pdf, and c.pdf" — or the first three plus "and 4 more". */
function nameList(names: string[]): string {
  return joinWithAnd(
    names.length <= MAX_NAMED
      ? names
      : [...names.slice(0, MAX_NAMED), `${names.length - MAX_NAMED} more`],
  );
}

export function summarizeMapWarnings(warnings: MapWarning[]): string[] {
  let redactedValues = 0;
  const redactedFiles = new Set<string>();

  // Insertion-ordered, so the card reads in the order the pass hit the
  // problems rather than in some rank the advisor did not ask for.
  const groups = new Map<string, Set<string>>();

  for (const { source, message } of warnings) {
    const redaction = REDACTION.exec(message);
    if (redaction) {
      redactedValues += Number(redaction[1]);
      redactedFiles.add(source);
      continue;
    }
    const files = groups.get(message);
    if (files) files.add(source);
    else groups.set(message, new Set([source]));
  }

  const lines: string[] = [];
  for (const [message, files] of groups) {
    const sources = [...files];
    lines.push(
      sources.length === 1
        ? `${sources[0]}: ${message}`
        : `${message} — ${documents(sources.length)}: ${nameList(sources)}`,
    );
  }

  // Last, deliberately. It is a disclosure that nothing went wrong, and it
  // used to sit on top of the lines that say something did.
  if (redactedValues > 0) {
    const values = redactedValues === 1 ? "1 SSN-like value" : `${redactedValues} SSN-like values`;
    lines.push(
      redactedFiles.size === 1
        ? `Redacted ${values} from ${nameList([...redactedFiles])} before sending it to the AI extractor.`
        : `Redacted ${values} across ${documents(redactedFiles.size)} before sending them to the AI extractor.`,
    );
  }

  return lines;
}
