// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useScenarioWriter } from "../use-scenario-writer";

const CLIENT_ID = "client-123";
const SCENARIO_ID = "scen-456";
const PATH = "/clients/client-123/details/income";

let refreshSpy: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

function setUrl(search: string) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(search) as unknown as ReturnType<typeof useSearchParams>,
  );
}

beforeEach(() => {
  refreshSpy = vi.fn();
  vi.mocked(useRouter).mockReturnValue({
    push: vi.fn(),
    refresh: refreshSpy,
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(usePathname).mockReturnValue(PATH);
  setUrl("");
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchSpy);
});

describe("useScenarioWriter — base mode", () => {
  it("edit → calls baseFallback URL with PATCH + body, refreshes router", async () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    const res = await result.current.submit(
      {
        op: "edit",
        targetKind: "income",
        targetId: "inc-1",
        desiredFields: { name: "New Name" },
      },
      {
        url: `/api/clients/${CLIENT_ID}/incomes/inc-1`,
        method: "PATCH",
        body: { name: "New Name" },
      },
    );

    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/clients/${CLIENT_ID}/incomes/inc-1`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "New Name" }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("add → POSTs baseFallback URL with body", async () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    await result.current.submit(
      {
        op: "add",
        targetKind: "income",
        entity: { id: "new-id", name: "X" },
      },
      {
        url: `/api/clients/${CLIENT_ID}/incomes`,
        method: "POST",
        body: { name: "X" },
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "X" }));
  });

  it("remove → DELETEs baseFallback URL with no body", async () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    await result.current.submit(
      { op: "remove", targetKind: "income", targetId: "inc-1" },
      { url: `/api/clients/${CLIENT_ID}/incomes/inc-1`, method: "DELETE" },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });
});

describe("useScenarioWriter — scenario mode", () => {
  it("edit → POSTs unified route with op=edit + targetKind + targetId + desiredFields", async () => {
    setUrl(`scenario=${SCENARIO_ID}`);
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    await result.current.submit(
      {
        op: "edit",
        targetKind: "income",
        targetId: "inc-1",
        desiredFields: { name: "Renamed" },
      },
      {
        url: `/api/clients/${CLIENT_ID}/incomes/inc-1`,
        method: "PATCH",
        body: { name: "Renamed" },
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`,
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      op: "edit",
      targetKind: "income",
      targetId: "inc-1",
      desiredFields: { name: "Renamed" },
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("add → POSTs unified route with op=add + targetKind + entity", async () => {
    setUrl(`scenario=${SCENARIO_ID}`);
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    await result.current.submit(
      {
        op: "add",
        targetKind: "expense",
        entity: { id: "new-uuid", name: "Groceries" },
      },
      {
        url: `/api/clients/${CLIENT_ID}/expenses`,
        method: "POST",
        body: { name: "Groceries" },
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`,
    );
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      op: "add",
      targetKind: "expense",
      entity: { id: "new-uuid", name: "Groceries" },
    });
  });

  it("remove → POSTs unified route with op=remove + targetKind + targetId", async () => {
    setUrl(`scenario=${SCENARIO_ID}`);
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    await result.current.submit(
      { op: "remove", targetKind: "income", targetId: "inc-1" },
      { url: `/api/clients/${CLIENT_ID}/incomes/inc-1`, method: "DELETE" },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      op: "remove",
      targetKind: "income",
      targetId: "inc-1",
    });
  });

  it("non-ok response does not call router.refresh", async () => {
    setUrl(`scenario=${SCENARIO_ID}`);
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));

    const res = await result.current.submit(
      { op: "remove", targetKind: "income", targetId: "inc-1" },
      { url: `/api/clients/${CLIENT_ID}/incomes/inc-1`, method: "DELETE" },
    );

    expect(res.ok).toBe(false);
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

describe("useScenarioWriter — scenarioActive flag", () => {
  it("is false when no scenario param set", () => {
    setUrl("");
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));
    expect(result.current.scenarioActive).toBe(false);
  });

  it("is true when scenario param is set", () => {
    setUrl(`scenario=${SCENARIO_ID}`);
    const { result } = renderHook(() => useScenarioWriter(CLIENT_ID));
    expect(result.current.scenarioActive).toBe(true);
  });
});
