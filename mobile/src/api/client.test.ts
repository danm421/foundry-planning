import { describe, it, expect, vi } from "vitest";
import {
  createApiClient,
  ApiError,
  UnauthorizedError,
  ForbiddenError,
  NonJsonResponseError,
} from "./client";
import { fetchMe, NotPortalClientError } from "./portal";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const token = () => Promise.resolve("jwt-123");

describe("createApiClient", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/api/portal/me");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer jwt-123");
      return jsonResponse({ ok: true });
    });
    const api = createApiClient({ baseUrl: "https://api.test", getToken: token, fetchFn });
    await expect(api.get("/api/portal/me")).resolves.toEqual({ ok: true });
  });

  it("throws UnauthorizedError without a token, before any network call", async () => {
    const fetchFn = vi.fn();
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: () => Promise.resolve(null),
      fetchFn,
    });
    await expect(api.get("/x")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps 401 → UnauthorizedError and 403 → ForbiddenError", async () => {
    const api401 = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () => jsonResponse({ error: "unauthorized" }, 401),
    });
    await expect(api401.get("/x")).rejects.toBeInstanceOf(UnauthorizedError);
    const api403 = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () => jsonResponse({ error: "forbidden" }, 403),
    });
    await expect(api403.get("/x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NonJsonResponseError when middleware redirects to an HTML page", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () =>
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    await expect(api.get("/x")).rejects.toBeInstanceOf(NonJsonResponseError);
  });

  it("throws ApiError (not NonJsonResponseError) when 2xx response has malformed JSON body", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () =>
        new Response("{truncated", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(api.get("/x")).rejects.toThrow();
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/x")).rejects.not.toBeInstanceOf(NonJsonResponseError);
  });

  it("throws ApiError with the status for other failures", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () => jsonResponse({ error: "boom" }, 500),
    });
    await expect(api.get("/x")).rejects.toMatchObject({ status: 500 });
  });

  it("posts JSON bodies", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ a: 1 }));
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return jsonResponse({ ok: true });
    });
    const api = createApiClient({ baseUrl: "https://api.test", getToken: token, fetchFn });
    await expect(api.post("/x", { a: 1 })).resolves.toEqual({ ok: true });
  });

  it("puts JSON bodies", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect(init?.body).toBe(JSON.stringify({ reviewed: true }));
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    const api = createApiClient({ baseUrl: "https://api.test", getToken: () => Promise.resolve("t"), fetchFn });
    await expect(api.put("/x", { reviewed: true })).resolves.toEqual({ ok: true });
  });
});

describe("fetchMe", () => {
  it("maps ForbiddenError (advisor / unbound user) to NotPortalClientError", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () => jsonResponse({ error: "Advisor session" }, 403),
    });
    await expect(fetchMe(api)).rejects.toBeInstanceOf(NotPortalClientError);
  });

  it("maps NonJsonResponseError (middleware page redirect) to NotPortalClientError", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      getToken: token,
      fetchFn: async () =>
        new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    await expect(fetchMe(api)).rejects.toBeInstanceOf(NotPortalClientError);
  });
});
