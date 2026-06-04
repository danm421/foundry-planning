// src/lib/presentations/pages/blank/markdown-blocks.ts
// Pure markdown → block model for the Blank presentation page. Parses with the
// unified/remark pipeline (mdast), then flattens to the small subset the editor
// can emit. Framework-free and unit-testable (no react-pdf).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: Run[][] }
  | { type: "quote"; runs: Run[] };

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  children?: MdNode[];
}

export function parseMarkdownToBlocks(md: string): Block[] {
  if (!md.trim()) return [];
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as unknown as MdNode;
  const blocks: Block[] = [];
  for (const node of tree.children ?? []) {
    const block = nodeToBlock(node);
    if (block) blocks.push(block);
  }
  return blocks;
}

function nodeToBlock(node: MdNode): Block | null {
  switch (node.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, node.depth ?? 1)) as 1 | 2 | 3;
      return { type: "heading", level, runs: inlineRuns(node.children ?? []) };
    }
    case "paragraph":
      return { type: "paragraph", runs: inlineRuns(node.children ?? []) };
    case "blockquote": {
      const runs: Run[] = [];
      for (const child of node.children ?? []) runs.push(...inlineRuns(child.children ?? []));
      return { type: "quote", runs };
    }
    case "list": {
      const items: Run[][] = (node.children ?? []).map((li) => {
        const runs: Run[] = [];
        for (const child of li.children ?? []) runs.push(...inlineRuns(child.children ?? []));
        return runs;
      });
      return { type: "list", ordered: node.ordered ?? false, items };
    }
    default:
      return null;
  }
}

function inlineRuns(nodes: MdNode[], marks: Omit<Run, "text"> = {}): Run[] {
  const runs: Run[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        if (n.value) runs.push({ text: n.value, ...marks });
        break;
      case "strong":
        runs.push(...inlineRuns(n.children ?? [], { ...marks, bold: true }));
        break;
      case "emphasis":
        runs.push(...inlineRuns(n.children ?? [], { ...marks, italic: true }));
        break;
      case "inlineCode":
        if (n.value) runs.push({ text: n.value, ...marks, code: true });
        break;
      default:
        if (n.children) runs.push(...inlineRuns(n.children, marks));
        else if (n.value) runs.push({ text: n.value, ...marks });
    }
  }
  return runs;
}
