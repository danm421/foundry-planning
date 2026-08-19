import { describe, it, expect } from "vitest";
import { TIDBITS, tidbitsById, renderTidbits, type TidbitTopic } from "../tidbits";

const ALL_TOPICS: TidbitTopic[] = [
  "compounding",
  "taxes",
  "debt",
  "behavior",
  "accounts",
  "risk",
];

describe("TIDBITS", () => {
  it("ships at least 25 tidbits", () => {
    expect(TIDBITS.length).toBeGreaterThanOrEqual(25);
  });

  it("has unique, stable, kebab-case ids", () => {
    const ids = TIDBITS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("keeps every body short enough for a sidebar", () => {
    for (const t of TIDBITS) expect(t.body.length).toBeLessThanOrEqual(320);
  });

  it("covers every topic with more than one entry", () => {
    for (const topic of ALL_TOPICS) {
      const count = TIDBITS.filter((t) => t.topic === topic).length;
      expect(count).toBeGreaterThan(1);
    }
  });

  it("has no exact-duplicate bodies", () => {
    const bodies = TIDBITS.map((t) => t.body);
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe("tidbitsById", () => {
  it("returns the picks in the order asked for", () => {
    const [a, b] = TIDBITS;
    expect(tidbitsById([b.id, a.id]).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it("drops an id that is no longer in the library", () => {
    expect(tidbitsById(["no-such-tidbit"])).toEqual([]);
  });
});

describe("renderTidbits", () => {
  it("substitutes plan tokens in the body", () => {
    const rendered = renderTidbits(["compounding-runway"], { client_first_name: "Dana" });
    expect(rendered[0].body).toContain("Dana");
    expect(rendered[0].body).not.toContain("{{");
  });

  it("leaves a body with no tokens unchanged", () => {
    const source = TIDBITS.find((t) => !t.body.includes("{{"))!;
    expect(renderTidbits([source.id], {})[0].body).toBe(source.body);
  });

  it("accepts a null token value (resolveAllTokens' real return shape) without throwing", () => {
    const rendered = renderTidbits(["compounding-runway"], { client_first_name: null });
    expect(rendered[0].body).not.toContain("{{");
  });
});
