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
  render: ({ instanceId, config, editing, onTextChange }) => {
    const parsed = TextConfigSchema.safeParse(config);
    const body = parsed.success ? parsed.data.markdown : "";

    if (editing) {
      return (
        <section className="px-6 py-3">
          <textarea
            className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
            rows={4}
            value={body}
            onChange={(e) => onTextChange?.(instanceId, e.target.value)}
            placeholder="Type markdown… **bold**, *italic*, - list items"
            data-text-editor-instance={instanceId}
            autoFocus={body === ""}
          />
        </section>
      );
    }

    if (body.trim() === "") {
      return (
        <section className="px-6 py-4">
          <div className="rounded border border-dashed border-slate-800 px-4 py-3 text-xs italic text-slate-500">
            Empty text block — open the Widget panel to add content.
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
