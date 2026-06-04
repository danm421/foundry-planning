import { parseMarkdownToBlocks, type Block } from "./markdown-blocks";
import type { BlankPageOptions } from "./options-schema";

export interface BlankPageData {
  blocks: Block[];
}

export function buildBlankPageData(options: BlankPageOptions): BlankPageData {
  return { blocks: parseMarkdownToBlocks(options.markdown) };
}
