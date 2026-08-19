import { describe, it, expect, vi } from "vitest";
import { derivedKey, buildDerivedBundle } from "../derived-refs";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";

const tree = (tag: string): ClientData => ({ tag } as unknown as ClientData);
const proj = (tag: string): ProjectionResult => ({ tag } as unknown as ProjectionResult);

describe("derivedKey", () => {
  it("namespaces by page so two pages never collide on the same local key", () => {
    expect(derivedKey("earlyYearsLadder", "rung1")).toBe("derived:earlyYearsLadder:rung1");
    expect(derivedKey("earlyYearsStanding", "rung1")).not.toBe(
      derivedKey("earlyYearsLadder", "rung1"),
    );
  });
});

describe("buildDerivedBundle", () => {
  const req = {
    key: "rung1",
    from: "base",
    label: "Save 14%",
    mutations: [
      { kind: "savings-annual-percent", accountId: "acct-1", percent: 0.14 },
    ] as never,
  };

  it("applies the mutations to the source tree and projects the result", () => {
    const mutated = tree("mutated");
    const applied = vi.fn().mockReturnValue(mutated);
    const run = vi.fn().mockReturnValue(proj("projected"));

    const bundle = buildDerivedBundle(tree("base"), req, { applyMutations: applied, runProjection: run });

    expect(applied).toHaveBeenCalledWith(tree("base"), req.mutations);
    expect(run).toHaveBeenCalledWith(mutated);
    expect(bundle.clientData).toBe(mutated);
    expect(bundle.projection).toEqual(proj("projected"));
  });

  it("resolves a mutation factory against the source tree before applying it", () => {
    const factory = vi.fn().mockReturnValue([]);
    const applied = vi.fn().mockReturnValue(tree("mutated"));
    buildDerivedBundle(tree("base"), { ...req, mutations: factory }, {
      applyMutations: applied, runProjection: () => proj("p"),
    });
    expect(factory).toHaveBeenCalledWith(tree("base"));
    expect(applied).toHaveBeenCalledWith(tree("base"), []);
  });

  it("labels the bundle with the request's label, not the source's", () => {
    const bundle = buildDerivedBundle(tree("base"), req, {
      applyMutations: () => tree("mutated"),
      runProjection: () => proj("p"),
    });
    expect(bundle.scenarioLabel).toBe("Save 14%");
  });
});
