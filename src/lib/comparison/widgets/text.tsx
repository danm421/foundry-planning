import { z } from "zod";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComparisonWidgetDefinition } from "./types";

const TextConfigSchema = z.object({ markdown: z.string() });
type TextConfig = z.infer<typeof TextConfigSchema>;

export const textWidget: ComparisonWidgetDefinition<TextConfig> = {
  kind: "text",
  title: "Text block",
  needsMc: false,
  configSchema: TextConfigSchema,
  defaultConfig: { markdown: "" },
  render: ({ config, collapsed }) => {
    if (collapsed) return null;
    const parsed = TextConfigSchema.safeParse(config);
    const body = parsed.success ? parsed.data.markdown : "";
    if (body.trim() === "") {
      return (
        <section className="px-6 py-4">
          <div className="rounded border border-dashed border-slate-800 px-4 py-3 text-xs italic text-slate-500">
            Empty text block — open Customize to add content.
          </div>
        </section>
      );
    }
    return (
      <section className="prose prose-invert prose-sm max-w-none px-6 py-4">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={[
            "h1", "h2", "h3", "p", "strong", "em", "a",
            "ul", "ol", "li", "code", "pre",
            "blockquote", "table", "thead", "tbody", "tr", "th", "td",
            "hr", "br",
          ]}
          unwrapDisallowed
        >
          {body}
        </ReactMarkdown>
      </section>
    );
  },
};
