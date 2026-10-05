// src/app/api/knowledge-hub/videos/[slug]/poster/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ gate: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/forge-access", () => ({ forgeViewerGate: m.gate }));
vi.mock("@vercel/blob", () => ({ get: m.get }));
vi.mock("@/domain/forge/help/videos", async () => {
  const f = await import("@/domain/forge/help/__tests__/help-video-fixtures");
  return { getHelpVideo: (s: string) => [f.EXPENSE_VIDEO].find((v) => v.slug === s) };
});

import { GET } from "../route";
import { EXPENSE_VIDEO as V } from "@/domain/forge/help/__tests__/help-video-fixtures";

const p12 = V.poster.sha256.slice(0, 12);
const req = (slug: string, v: string) => new Request(`http://x/api/knowledge-hub/videos/${slug}/poster?v=${v}`);
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  m.gate.mockReset().mockResolvedValue(null);
  m.get.mockReset().mockResolvedValue({
    statusCode: 200,
    stream: new ReadableStream({ start(c) { c.close(); } }),
    headers: new Headers(),
    blob: {},
  });
});

describe("GET /api/knowledge-hub/videos/[slug]/poster", () => {
  it("serves the poster as a cacheable private jpeg", async () => {
    const res = await GET(req(V.slug, p12), params(V.slug));
    expect(res.status).toBe(200);
    expect(m.get).toHaveBeenCalledWith(V.poster.path, { access: "private" });
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("returns the gate's response when access is denied", async () => {
    m.gate.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await GET(req(V.slug, p12), params(V.slug))).status).toBe(403);
  });

  it("404s an unknown slug or a stale ?v=", async () => {
    expect((await GET(req("nope", p12), params("nope"))).status).toBe(404);
    expect((await GET(req(V.slug, "000000000000"), params(V.slug))).status).toBe(404);
  });

  it("502s when storage throws, logging the slug but not the error's token or URL", async () => {
    m.get.mockRejectedValue(new Error("Vercel Blob: 503 at https://store.example/secret?token=vercel_blob_rw_SECRET"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await GET(req(V.slug, p12), params(V.slug))).status).toBe(502);
      expect(log).toHaveBeenCalledWith("knowledge-hub: poster read failed", { slug: V.slug });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|https:/);
    } finally {
      log.mockRestore();
    }
  });
});
