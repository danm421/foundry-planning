import { z } from "zod";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TextWidgetConfigSchema } from "../layout-schema";
import type { ComparisonWidgetDefinition } from "./types";

type TextConfig = z.infer<typeof TextWidgetConfigSchema>;

export const textWidget: ComparisonWidgetDefinition<TextConfig> = {
  kind: "text",
  title: "Text block",
  category: "text",
  scenarios: "none",
  needsMc: false,
  configSchema: TextWidgetConfigSchema,
  defaultConfig: { markdown: "" },
  render: ({ cellId, config, editing, onExpand }) => {
    const parsed = TextWidgetConfigSchema.safeParse(config);
    const body = parsed.success ? parsed.data.markdown : "";

    const handleExpand = () => {
      if (!cellId) return;
      onExpand?.(cellId, editing ? "edit" : "view");
    };

    return (
      <section className="relative px-6 py-4">
        {body.trim() === "" ? (
          <button
            type="button"
            onClick={handleExpand}
            className="w-full rounded border border-dashed border-slate-700 px-4 py-6 text-xs italic text-ink-3 hover:border-amber-400 hover:text-amber-200"
          >
            Empty text block — click to add content
          </button>
        ) : (
          <>
            <div
              className="prose prose-invert prose-sm max-w-none overflow-hidden"
              style={{ maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)" }}
              aria-hidden={false}
            >
              <div className="line-clamp-6">
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
              </div>
            </div>
            <button
              type="button"
              onClick={handleExpand}
              className="absolute bottom-2 right-3 rounded border border-slate-700 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-200 hover:border-amber-400 hover:text-amber-200"
            >
              {editing ? "Expand to edit" : "Show full"}
            </button>
          </>
        )}
      </section>
    );
  },
};
