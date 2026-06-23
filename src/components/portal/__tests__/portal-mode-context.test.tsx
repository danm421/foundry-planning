// src/components/portal/__tests__/portal-mode-context.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { PortalModeProvider, usePortalFetch } from "../portal-mode-context";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
});

describe("usePortalFetch", () => {
  it("client mode (default): plain fetch, no act-as header", async () => {
    const { result } = renderHook(() => usePortalFetch());
    await result.current("/api/portal/accounts", { method: "POST" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-portal-as-client")).toBeNull();
  });

  it("advisor mode: attaches x-portal-as-client header", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PortalModeProvider value={{ mode: "advisor", clientId: "client-7" }}>
        {children}
      </PortalModeProvider>
    );
    const { result } = renderHook(() => usePortalFetch(), { wrapper });
    await result.current("/api/portal/accounts", { method: "POST" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("x-portal-as-client")).toBe("client-7");
  });

  it("advisor mode: preserves existing headers", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PortalModeProvider value={{ mode: "advisor", clientId: "client-7" }}>
        {children}
      </PortalModeProvider>
    );
    const { result } = renderHook(() => usePortalFetch(), { wrapper });
    await result.current("/api/portal/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-portal-as-client")).toBe("client-7");
  });
});
