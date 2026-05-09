import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { _resetRegistry, registerArtifact, getArtifact, listArtifacts } from "../registry";
import type { ReportArtifact } from "../types";

const fakeArtifact = (id: string): ReportArtifact<{ n: number }, z.ZodObject<{}>> => ({
  id,
  title: id,
  section: "assets",
  route: `/clients/x/${id}`,
  variants: ["data"],
  optionsSchema: z.object({}),
  defaultOptions: {},
  fetchData: async () => ({ data: { n: 1 }, asOf: new Date(), dataVersion: "v1" }),
  renderPdf: () => null,
});

describe("registry", () => {
  beforeEach(() => _resetRegistry());

  it("registers and retrieves by id", () => {
    registerArtifact(fakeArtifact("a"));
    expect(getArtifact("a")?.id).toBe("a");
  });

  it("returns undefined for unknown id (no throw)", () => {
    expect(getArtifact("missing")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    registerArtifact(fakeArtifact("a"));
    expect(() => registerArtifact(fakeArtifact("a"))).toThrow(/already registered/);
  });

  it("listArtifacts returns all registered, in insertion order", () => {
    registerArtifact(fakeArtifact("a"));
    registerArtifact(fakeArtifact("b"));
    registerArtifact(fakeArtifact("c"));
    expect(listArtifacts().map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});

describe("bootstrap (index.ts)", () => {
  it("registers investmentsArtifact when index is imported", async () => {
    _resetRegistry();
    // Re-evaluate the bootstrap module so register runs against the fresh registry.
    vi.resetModules();
    await import("../index");
    const { getArtifact } = await import("../registry");
    expect(getArtifact("investments")?.id).toBe("investments");
  });
});
