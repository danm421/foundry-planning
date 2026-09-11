/**
 * Advisor-readable text for a route's error body.
 *
 * Routes answer a schema rejection with `{ error: "Invalid body", issues:
 * [{ path, message }] }`. Both halves are written for a developer: the summary
 * names no field at all, and the issue text is Zod's own ("Invalid UUID
 * format", "Invalid input: expected number, received NaN"). Shown verbatim —
 * or, worse, dropped in favour of the bare summary — they tell an advisor
 * nothing about which box on the form to fix.
 *
 * `describeApiError` maps each issue's path to the label the form actually
 * shows and rewrites Zod's generic phrasings into an instruction. A message
 * that matches none of those patterns is a hand-written one (a `superRefine`
 * rule, say) that already reads as a sentence, so it passes through whole —
 * prefixing it with a field label would only stutter.
 */

export interface ApiErrorBody {
  error?: string;
  issues?: { path: string; message: string }[];
}

/** Zod's generic complaints → what the advisor should do about them.
 *  Returns null when the message isn't one of them. */
function instructionFor(message: string): string | null {
  if (/invalid uuid|invalid option|invalid enum|expected one of/i.test(message)) {
    return "pick an option from the list";
  }
  // Bounds first: Zod phrases them as "Too big: expected number to be <=1",
  // which the plain "expected number" test below would otherwise swallow into
  // the useless "enter a number" for a box that already holds one.
  const tooSmallNumber = /too small.*number.*>=?\s*(-?[\d.]+)/i.exec(message);
  if (tooSmallNumber) return `must be ${tooSmallNumber[1]} or more`;
  const tooBigNumber = /too big.*number.*<=?\s*(-?[\d.]+)/i.exec(message);
  if (tooBigNumber) return `must be ${tooBigNumber[1]} or less`;
  if (/expected number/i.test(message)) return "enter a number";
  if (/too small.*string|expected string|expected boolean|expected array/i.test(message)) {
    return "this is required";
  }
  return null;
}

/** The label for a nested path, taking the OUTERMOST segment that has one:
 *  `ownerRef.id` is the Owner field and `cashValueSchedule.3.premiumAmount` is
 *  the Schedule, while a body that is itself an array puts a row index first
 *  (`2.percentage`) and has to fall through to the column. An unmapped path
 *  names itself rather than vanishing. */
function labelFor(path: string, labels: Record<string, string>): string {
  if (labels[path]) return labels[path];
  for (const segment of path.split(".")) {
    if (labels[segment]) return labels[segment];
  }
  return path;
}

/**
 * One sentence (or a few) an advisor can act on.
 *
 * @param labels path → the label shown on the form, e.g. `{ faceValue: "Death benefit" }`.
 *               Nested paths fall back to their outermost labelled segment.
 * @param fallback used when the body carries neither issues nor an error string.
 */
export function describeApiError(
  body: ApiErrorBody,
  status: number,
  { labels = {}, fallback }: { labels?: Record<string, string>; fallback?: string } = {},
): string {
  const issues = body.issues ?? [];
  if (issues.length > 0) {
    // The summary ("Invalid body") adds nothing once the issues can name
    // themselves, so it's dropped rather than prefixed.
    return issues
      .map(({ path, message }) => {
        const instruction = instructionFor(message);
        if (!instruction) return message.replace(/\.?$/, ".");
        return path ? `${labelFor(path, labels)}: ${instruction}.` : `${instruction}.`;
      })
      .join(" ");
  }
  return body.error ?? fallback ?? `Something went wrong (HTTP ${status}).`;
}
