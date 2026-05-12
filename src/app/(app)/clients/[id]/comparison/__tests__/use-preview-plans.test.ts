// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePreviewPlans } from "../use-preview-plans";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

describe("usePreviewPlans", () => {
  it("returns idle and skips fetch while disabled", () => {
    const { result } = renderHook(() =>
      usePreviewPlans({ clientId: "c", planIds: ["base"], enabled: false }),
    );
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the union of planIds and returns plans on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plans: [{ id: "base" }, { id: "sc-1" }] }),
    });
    const { result } = renderHook(() =>
      usePreviewPlans({ clientId: "c", planIds: ["base", "sc-1", "base"], enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.plans).toEqual(["base", "sc-1"]);
    expect(result.current.plans?.map((p: { id: string }) => p.id)).toEqual(["base", "sc-1"]);
  });

  it("emits error status on non-OK response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() =>
      usePreviewPlans({ clientId: "c", planIds: ["base"], enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("caches by planIds: re-enabling with the same set doesn't refetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plans: [{ id: "base" }] }),
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePreviewPlans({ clientId: "c", planIds: ["base"], enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    rerender({ enabled: true });
    // No new fetch — cached.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("refetches when planIds set changes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plans: [] }),
    });
    const { result, rerender } = renderHook(
      ({ planIds }: { planIds: string[] }) =>
        usePreviewPlans({ clientId: "c", planIds, enabled: true }),
      { initialProps: { planIds: ["base"] } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ planIds: ["base", "sc-1"] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("treats empty planIds as idle (no fetch)", () => {
    const { result } = renderHook(() =>
      usePreviewPlans({ clientId: "c", planIds: [], enabled: true }),
    );
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
