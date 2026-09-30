/**
 * Errors → text that is safe to put in a log line or a Sentry event.
 *
 * A raw error object is not safe to print. The Neon driver keeps its whole
 * config — DATABASE_URL, password included — on its client, and the pool pins
 * that client onto an idle-connection error as `err.client`. `console.error(err)`
 * prints every enumerable property a couple of levels deep, so it printed the
 * production password into Vercel's runtime logs.
 *
 * `safeErrorFields` keeps only name/message/code/stack, and `redactSecrets`
 * masks any credentials embedded in a URL (`postgres://user:password@host`)
 * in whatever text is left; `scrubSecrets` masks the same URLs, plus any
 * password-named key, across a whole Sentry event. All pure, so they run on
 * Node and Edge alike.
 */

// scheme://user:password@ — the user is kept, the password masked.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]*):[^\s/?#@]+@/gi;

// Keys whose value is a credential whatever it looks like (a bare password
// carries no URL shape to match on).
const SECRET_KEYS = /^(password|connectionString)$/i;

const REDACTED = "[REDACTED]";

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, `$1:${REDACTED}@`);
}

export interface SafeErrorFields {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

/** The loggable part of anything thrown. A non-Error is stringified, never
 *  inspected, so an object's contents can't ride along. */
export function safeErrorFields(err: unknown): SafeErrorFields {
  if (!(err instanceof Error)) return { name: "NonError", message: redactSecrets(String(err)) };
  const code = (err as { code?: unknown }).code;
  return {
    name: err.name,
    message: redactSecrets(err.message),
    ...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
    ...(err.stack ? { stack: redactSecrets(err.stack) } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep copy of a Sentry event with credentials masked: URL passwords in every
 * string, and the whole value under a password-named key. Only arrays and
 * plain objects are rebuilt — SDK internals (the `Scope` instances in
 * `sdkProcessingMetadata`) are passed through untouched.
 */
export function scrubSecrets<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(scrubSecrets) as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? REDACTED : scrubSecrets(v);
  }
  return out as T;
}
