// src/app/api/knowledge-hub/videos/[slug]/poster/route.ts
//
// A Knowledge Hub video's poster (the card thumbnail). Same gate, slug
// allowlist and ?v= content-hash check as the video route.
import { get } from "@vercel/blob";
import { forgeViewerGate } from "@/lib/forge-access";
import { getHelpVideo } from "@/domain/forge/help/videos";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = await forgeViewerGate();
  if (denied) return denied;

  const { slug } = await ctx.params;
  const video = getHelpVideo(slug);
  if (!video || new URL(req.url).searchParams.get("v") !== video.poster.sha256.slice(0, 12)) {
    return new Response("Not found", { status: 404 });
  }

  const result = await get(video.poster.path, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return new Response("Not found", { status: 404 });
  return new Response(result.stream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
