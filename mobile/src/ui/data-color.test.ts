import { describe, it, expect } from "vitest";
import { tokenToHex } from "./data-color";

describe("tokenToHex", () => {
  it("maps var(--data-*) tokens to dark-theme hex", () => {
    expect(tokenToHex("var(--data-blue)")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(tokenToHex("var(--data-teal)")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("accepts bare palette names", () => {
    expect(tokenToHex("green")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
  it("passes through an existing hex", () => {
    expect(tokenToHex("#4fd0bf")).toBe("#4fd0bf");
  });
  it("falls back to a neutral grey for unknown tokens", () => {
    expect(tokenToHex("var(--data-chartreuse)")).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(tokenToHex("")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
