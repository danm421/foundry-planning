// src/lib/ai/shared-client-error.ts
//
// Its own module, with no imports, because two sides need it that must not
// need each other: resolve.ts throws it, and `authErrorResponse`
// (src/lib/authz.ts) turns it into a 403. resolve.ts cannot import authz.ts —
// that pulls `server-only` modules into scripts/ingest-planning-kb.ts, which
// reaches the resolver outside Next.

/**
 * An AI call on a client shared in from another firm that runs AI in its own
 * Azure tenant. A share does not license the owning firm's tenant, and running
 * that firm's client data anywhere else breaks the promise it connected for,
 * so the call is refused. The message is shown to the advisor as-is.
 */
export class SharedClientAiError extends Error {
  constructor() {
    super(
      "AI features aren't available on a client shared from a firm that uses its own AI connection.",
    );
    this.name = "SharedClientAiError";
  }
}
