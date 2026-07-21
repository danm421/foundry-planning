// src/domain/forge/__tests__/custom-event-helpers.ts
//
// Shared drain for graph.streamEvents() runs in the approval-path frame tests.
// Custom events are how tools reach the BROWSER (tool results only reach the
// model), so "did this frame survive the run" is the assertion those tests are
// built around — and it is worth having exactly one filter predicate for it.

/** A `tool_render` frame's payload, as it arrives on the stream. */
export interface ToolRenderFrame {
  name: string;
  data: unknown;
}

/**
 * Consume a streamEvents run to completion, returning the `tool_render` frames
 * it emitted. Draining fully matters: the run only reaches its interrupt (or
 * its end) once the generator is exhausted.
 */
export async function toolRenderFrames(
  stream: AsyncGenerator<{ event: string; name?: string; data?: unknown }>,
): Promise<ToolRenderFrame[]> {
  const frames: ToolRenderFrame[] = [];
  for await (const ev of stream) {
    if (ev.event === "on_custom_event" && ev.name === "tool_render") {
      frames.push(ev.data as ToolRenderFrame);
    }
  }
  return frames;
}

/** The tool names behind each `tool_render` frame, in order. */
export async function toolRenderNames(
  stream: AsyncGenerator<{ event: string; name?: string; data?: unknown }>,
): Promise<string[]> {
  return (await toolRenderFrames(stream)).map((f) => f.name);
}
