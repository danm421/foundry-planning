// mobile/src/api/client.ts
//
// Pure typed fetch wrapper for /api/portal/*. No React, no react-native
// imports — unit-tested with plain vitest.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}
export class UnauthorizedError extends ApiError {
  constructor() {
    super("unauthorized", 401);
    this.name = "UnauthorizedError";
  }
}
export class ForbiddenError extends ApiError {
  constructor(message = "forbidden") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}
/** The Clerk middleware redirected us to an HTML page (advisor/unbound user
 *  hitting a portal page redirect) instead of a JSON API response. */
export class NonJsonResponseError extends ApiError {
  constructor(status: number) {
    super("non-json response", status);
    this.name = "NonJsonResponseError";
  }
}

export interface ApiClientOpts {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

export function createApiClient(opts: ApiClientOpts): ApiClient {
  const fetchFn = opts.fetchFn ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await opts.getToken();
    if (!token) throw new UnauthorizedError();
    const res = await fetchFn(`${opts.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 403) throw new ForbiddenError();
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new NonJsonResponseError(res.status);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError("invalid JSON response", res.status);
    }
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
