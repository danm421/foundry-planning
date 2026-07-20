import { describe, it, expect } from "vitest";
import {
  classifyActor,
  actorNameFromMetadata,
  isClerkUserId,
  pickActor,
} from "../actor-display";

describe("isClerkUserId", () => {
  it("is true only for user_-prefixed ids", () => {
    expect(isClerkUserId("user_abc")).toBe(true);
    expect(isClerkUserId("org_abc")).toBe(false);
    expect(isClerkUserId("system")).toBe(false);
  });
});

describe("classifyActor", () => {
  it("labels system / webhook actors", () => {
    expect(classifyActor("system")).toEqual({ name: "System", isSystem: true });
    expect(classifyActor("clerk:webhook")).toEqual({
      name: "System",
      isSystem: true,
    });
  });

  it("labels org-id artifacts as System (not Former member)", () => {
    expect(classifyActor("org_3CitTEIe8PJa1BVYw7LnEjkiP9r")).toEqual({
      name: "System",
      isSystem: true,
    });
  });

  it("returns null for user-shaped ids (caller resolves via Clerk)", () => {
    expect(classifyActor("user_3CNEarpTz0k9nI7gWESXLGMTI7k")).toBeNull();
  });

  it("labels an empty/whitespace actor id as System, not Former member", () => {
    expect(classifyActor("")).toEqual({ name: "System", isSystem: true });
    expect(classifyActor("   ")).toEqual({ name: "System", isSystem: true });
  });
});

describe("actorNameFromMetadata", () => {
  it("extracts a trimmed string actorName", () => {
    expect(actorNameFromMetadata({ actorName: " Dan Mueller " })).toBe(
      "Dan Mueller",
    );
  });

  it("ignores missing / non-string / empty", () => {
    expect(actorNameFromMetadata(null)).toBeNull();
    expect(actorNameFromMetadata({})).toBeNull();
    expect(actorNameFromMetadata({ actorName: 42 })).toBeNull();
    expect(actorNameFromMetadata({ actorName: "   " })).toBeNull();
  });
});

describe("pickActor precedence", () => {
  const live = new Map([["user_live", "Live Name"]]);

  it("1) system label wins over everything", () => {
    expect(pickActor("system", { actorName: "ignored" }, live)).toEqual({
      name: "System",
      isSystem: true,
    });
  });

  it("2) live Clerk name beats snapshot", () => {
    expect(
      pickActor("user_live", { actorName: "Stale Snapshot" }, live),
    ).toEqual({ name: "Live Name", isSystem: false });
  });

  it("3) snapshot used when Clerk no longer resolves the user", () => {
    expect(
      pickActor("user_departed", { actorName: "Departed Advisor" }, live),
    ).toEqual({ name: "Departed Advisor", isSystem: false });
  });

  it("4) Former member when no live name and no snapshot", () => {
    expect(pickActor("user_gone", { kind: "create" }, live)).toEqual({
      name: "Former member",
      isSystem: false,
    });
  });

  it("does not attribute an empty actor id to a departed member", () => {
    expect(pickActor("", null, new Map())).toEqual({
      name: "System",
      isSystem: true,
    });
  });
});
