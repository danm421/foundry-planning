// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";

vi.mock("@/lib/solver/estate-impact", () => ({
  estateImpactOf: (_p: unknown, tree: { tag: string }) => ({
    taxesAndCosts: tree.tag === "after" ? 1 : 2,
    toHeirs: 10,
    finalDeathYear: 2045,
  }),
}));
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: () => ({ tag: "after" }),
}));

import { useGuidedTrustImpact } from "../use-guided-trust-impact";

const tree = { tag: "before" } as unknown as ClientData;
const mut = (id: string) => ({ kind: "held-change", id }) as unknown as SolverMutation;
const current = [mut("a")];

function ok() {
  return { ok: true, text: async () => JSON.stringify({ projectionResult: { years: [] } }) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup(batch: SolverMutation[], enabled = true) {
  return renderHook(
    (p: { batch: SolverMutation[]; enabled: boolean }) =>
      useGuidedTrustImpact({ clientId: "c1", source: "base", mutations: current, tree, ...p }),
    { initialProps: { batch, enabled } },
  );
}

describe("useGuidedTrustImpact", () => {
  it("posts current and current+batch, then is ready", async () => {
    const { result } = setup([mut("x"), mut("y")]);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const lens = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).mutations.length).sort();
    expect(lens).toEqual([1, 3]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).includeEvents).toBe(true);
    expect(result.current.before?.taxesAndCosts).toBe(2);
    expect(result.current.after?.taxesAndCosts).toBe(1);
  });

  it("goes to error on a 500", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    const { result } = setup([mut("x")]);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.after).toBeNull();
  });

  it("does not fetch while disabled", async () => {
    const { result } = setup([mut("x")], false);
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not refetch for an equal-content batch array", async () => {
    const { result, rerender } = setup([mut("x")]);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ batch: [mut("x")], enabled: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ready");
  });
});
