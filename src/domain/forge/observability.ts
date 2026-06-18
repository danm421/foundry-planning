// Flag-gated Langfuse tracing for the forge graph. Returns null (a no-op) unless
// FORGE_LANGFUSE_ENABLED is strictly "true" AND all three LANGFUSE_* keys are
// present — mirroring the fail-quiet contract of assertForgeAzureConfig. The
// handler is OBSERVE-ONLY: it must never mutate invocationParams (a temperature
// would reintroduce the Azure reasoning-model 400). Default OFF until the
// hosting/PII decision lands.
//
// SDK SHAPE (verified against @langfuse/langchain 5.4.1): this is the modern,
// OpenTelemetry-based Langfuse SDK. The CallbackHandler emits OTEL spans; those
// spans only reach Langfuse if a TracerProvider carrying a LangfuseSpanProcessor
// is registered. We register one lazily, once per process, the first time a
// handler is requested. Flushing happens on the PROCESSOR (forceFlush), NOT the
// handler — the handler exposes no flush method.
import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { ForgeAuthContext } from "./state";

/** Resolve the base URL from either env spelling (v5 reads LANGFUSE_BASE_URL;
 *  older configs / the eval harness use LANGFUSE_BASEURL). */
function baseUrl(): string | undefined {
  return process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_BASEURL;
}

function langfuseConfigured(): boolean {
  return (
    process.env.FORGE_LANGFUSE_ENABLED === "true" &&
    !!process.env.LANGFUSE_PUBLIC_KEY &&
    !!process.env.LANGFUSE_SECRET_KEY &&
    !!baseUrl()
  );
}

// Module-level singletons: the span processor is what we force-flush, and the
// NodeSDK is registered exactly once. Each opens network/batching state — one set
// per process, like getCheckpointer's pooled connection.
let processor: LangfuseSpanProcessor | null = null;
let tracingStarted = false;

/**
 * Register a TracerProvider carrying the Langfuse span processor, once. Fails
 * quiet: if a global provider is already registered (e.g. Vercel's auto-OTEL),
 * NodeSDK.start() warns and our processor may not attach — at activation time
 * (the PII/hosting decision) move this wiring into instrumentation.ts so it
 * composes with the platform provider. Dormant until then (flag OFF).
 */
function ensureTracing(): void {
  if (tracingStarted) return;
  tracingStarted = true;
  try {
    processor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: baseUrl(),
    });
    new NodeSDK({ spanProcessors: [processor] }).start();
  } catch {
    // Never let observability setup break a chat turn.
    processor = null;
  }
}

/**
 * Build a Langfuse LangChain CallbackHandler scoped to one conversation, or null
 * when disabled/unconfigured. Pass the result into the `callbacks` array of
 * graph.streamEvents — a null handler simply isn't added.
 */
export function maybeLangfuseHandler(
  authContext: ForgeAuthContext,
  conversationId: string,
): CallbackHandler | null {
  if (!langfuseConfigured()) return null;
  ensureTracing();
  return new CallbackHandler({
    sessionId: conversationId,
    userId: authContext.userId,
    traceMetadata: {
      firmId: authContext.firmId,
      clientId: authContext.clientId,
      scenarioId: authContext.scenarioId,
    },
  });
}

/**
 * Force-flush spans before the Vercel lambda freezes (the one serverless
 * footgun — async background flushing drops spans after the response closes).
 * Safe with a null handler. The `handler` arg is the "tracing was on this turn"
 * sentinel; the actual flush is on the module-level LangfuseSpanProcessor.
 */
export async function flushLangfuse(handler: CallbackHandler | null): Promise<void> {
  if (!handler || !processor) return;
  await processor.forceFlush();
}
