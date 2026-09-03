import { describe, it, expect } from "vitest";
import {
  OBSERVATION_TOPICS,
  observationCreateSchema,
  observationUpdateSchema,
  observationReorderSchema,
  observationBulkDeleteQuerySchema,
  observationContextPatchSchema,
  draftRunRequestSchema,
} from "@/lib/schemas/observations";

describe("OBSERVATION_TOPICS", () => {
  it("has the 8 canonical topics", () => {
    expect(OBSERVATION_TOPICS).toEqual([
      "retirement",
      "cash-flow",
      "investments",
      "tax",
      "insurance",
      "estate",
      "education",
      "general",
    ]);
  });
});

describe("observationCreateSchema", () => {
  it("accepts a minimal valid create", () => {
    const r = observationCreateSchema.safeParse({
      section: "observation",
      body: "Client is under-saving for retirement.",
    });
    expect(r.success).toBe(true);
  });

  it("defaults topic to 'general' and source to 'manual'", () => {
    const r = observationCreateSchema.parse({
      section: "next_step",
      body: "Open a Roth IRA.",
    });
    expect(r.topic).toBe("general");
    expect(r.source).toBe("manual");
  });

  it("accepts a fully populated create", () => {
    const r = observationCreateSchema.safeParse({
      section: "next_step",
      source: "ai",
      topic: "tax",
      title: "Consider Roth conversion",
      body: "Client's marginal rate is low this year.",
      owner: "advisor",
      priority: "high",
      targetDate: "2026-12-31",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(
      observationCreateSchema.safeParse({ section: "observation", body: "" }).success,
    ).toBe(false);
  });

  it("rejects a missing body", () => {
    expect(
      observationCreateSchema.safeParse({ section: "observation" }).success,
    ).toBe(false);
  });

  it("rejects an invalid section", () => {
    expect(
      observationCreateSchema.safeParse({ section: "todo", body: "x" }).success,
    ).toBe(false);
  });

  it("rejects an invalid topic", () => {
    expect(
      observationCreateSchema.safeParse({
        section: "observation",
        body: "x",
        topic: "not-a-topic",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed targetDate", () => {
    expect(
      observationCreateSchema.safeParse({
        section: "observation",
        body: "x",
        targetDate: "12/31/2026",
      }).success,
    ).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    expect(
      observationCreateSchema.safeParse({
        section: "observation",
        body: "x",
        title: "a".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("rejects body over 8000 chars", () => {
    expect(
      observationCreateSchema.safeParse({
        section: "observation",
        body: "a".repeat(8001),
      }).success,
    ).toBe(false);
  });
});

describe("observationUpdateSchema", () => {
  it("accepts an empty patch (no-op)", () => {
    expect(observationUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a status-only patch", () => {
    expect(
      observationUpdateSchema.safeParse({ status: "done" }).success,
    ).toBe(true);
  });

  it("accepts clearing title/owner/priority/targetDate via null", () => {
    const r = observationUpdateSchema.safeParse({
      title: null,
      owner: null,
      priority: null,
      targetDate: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(
      observationUpdateSchema.safeParse({ clientId: "sneak-through" }).success,
    ).toBe(false);
  });

  it("rejects an invalid status", () => {
    expect(
      observationUpdateSchema.safeParse({ status: "archived" }).success,
    ).toBe(false);
  });

  it("rejects an empty body when body is provided", () => {
    expect(observationUpdateSchema.safeParse({ body: "" }).success).toBe(false);
  });
});

describe("observationReorderSchema", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";

  it("accepts a valid ordered list of uuids", () => {
    const r = observationReorderSchema.safeParse({
      section: "observation",
      orderedIds: [uuid1, uuid2],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    expect(
      observationReorderSchema.safeParse({
        section: "observation",
        orderedIds: ["not-a-uuid"],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty orderedIds array", () => {
    expect(
      observationReorderSchema.safeParse({
        section: "observation",
        orderedIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing section", () => {
    expect(
      observationReorderSchema.safeParse({ orderedIds: [uuid1] }).success,
    ).toBe(false);
  });
});

describe("observationCreateSchema — audience and provenance", () => {
  it("defaults audience to client and sourceScenarioId to absent", () => {
    const r = observationCreateSchema.parse({ section: "observation", body: "x" });
    expect(r.audience).toBe("client");
    expect(r.sourceScenarioId).toBeUndefined();
  });
  it("accepts advisor audience and a uuid sourceScenarioId", () => {
    const r = observationCreateSchema.parse({
      section: "next_step",
      body: "x",
      audience: "advisor",
      sourceScenarioId: "11111111-1111-4111-8111-111111111111",
    });
    expect(r.audience).toBe("advisor");
    expect(r.sourceScenarioId).toBe("11111111-1111-4111-8111-111111111111");
  });
  it("rejects a non-uuid sourceScenarioId and an unknown audience", () => {
    expect(observationCreateSchema.safeParse({ section: "next_step", body: "x", sourceScenarioId: "nope" }).success).toBe(false);
    expect(observationCreateSchema.safeParse({ section: "next_step", body: "x", audience: "everyone" }).success).toBe(false);
  });
});

describe("observationBulkDeleteQuerySchema", () => {
  it("accepts only an ai-sourced section", () => {
    expect(observationBulkDeleteQuerySchema.safeParse({ section: "next_step", source: "ai" }).success).toBe(true);
    expect(observationBulkDeleteQuerySchema.safeParse({ section: "next_step", source: "manual" }).success).toBe(false);
    expect(observationBulkDeleteQuerySchema.safeParse({ source: "ai" }).success).toBe(false);
  });
});

describe("observationContextPatchSchema", () => {
  it("accepts any one field and rejects an empty body", () => {
    expect(observationContextPatchSchema.safeParse({ observationsContext: "notes" }).success).toBe(true);
    expect(observationContextPatchSchema.safeParse({ nextStepsScenarioId: null }).success).toBe(true);
    expect(observationContextPatchSchema.safeParse({}).success).toBe(false);
    expect(observationContextPatchSchema.safeParse({ nextStepsScenarioId: "nope" }).success).toBe(false);
    expect(observationContextPatchSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe("draftRunRequestSchema", () => {
  it("accepts an empty body, a section, or a scenario", () => {
    expect(draftRunRequestSchema.parse({})).toEqual({});
    expect(draftRunRequestSchema.parse({ section: "next_step" }).section).toBe("next_step");
    expect(draftRunRequestSchema.safeParse({ section: "both" }).success).toBe(false);
  });
});
