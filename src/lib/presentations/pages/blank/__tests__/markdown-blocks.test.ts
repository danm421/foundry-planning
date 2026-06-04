import { describe, it, expect } from "vitest";
import { parseMarkdownToBlocks } from "../markdown-blocks";

describe("parseMarkdownToBlocks", () => {
  it("returns [] for empty input", () => {
    expect(parseMarkdownToBlocks("")).toEqual([]);
  });

  it("parses a heading with its level", () => {
    const [b] = parseMarkdownToBlocks("## Title");
    expect(b).toEqual({ type: "heading", level: 2, runs: [{ text: "Title" }] });
  });

  it("caps heading level at 3", () => {
    const [b] = parseMarkdownToBlocks("##### Deep");
    expect(b).toMatchObject({ type: "heading", level: 3 });
  });

  it("parses bold and italic inline runs", () => {
    const [b] = parseMarkdownToBlocks("Plain **bold** and *italic*.");
    expect(b).toEqual({
      type: "paragraph",
      runs: [
        { text: "Plain " },
        { text: "bold", bold: true },
        { text: " and " },
        { text: "italic", italic: true },
        { text: "." },
      ],
    });
  });

  it("parses inline code", () => {
    const [b] = parseMarkdownToBlocks("Run `npm test` now.");
    expect(b).toMatchObject({
      type: "paragraph",
      runs: [{ text: "Run " }, { text: "npm test", code: true }, { text: " now." }],
    });
  });

  it("parses a bullet list", () => {
    const [b] = parseMarkdownToBlocks("- one\n- two");
    expect(b).toEqual({
      type: "list",
      ordered: false,
      items: [[{ text: "one" }], [{ text: "two" }]],
    });
  });

  it("parses an ordered list", () => {
    const [b] = parseMarkdownToBlocks("1. first\n2. second");
    expect(b).toMatchObject({ type: "list", ordered: true });
  });

  it("parses a blockquote", () => {
    const [b] = parseMarkdownToBlocks("> quoted");
    expect(b).toEqual({ type: "quote", runs: [{ text: "quoted" }] });
  });
});
