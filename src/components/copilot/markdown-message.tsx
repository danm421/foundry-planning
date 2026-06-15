// src/components/copilot/markdown-message.tsx
"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant markdown (bullets, code, tables, links) for streamed copilot
 * bubbles, styled with Foundry CSS-var tokens (no hardcoded hex). The indigo
 * `--color-secondary` token marks AI accents (links + list markers). All long
 * tokens wrap so nothing overflows its bubble. Memoized because streaming
 * re-renders the same growing string on every token delta.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink-2 break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => (
            <ul className="ml-1 list-disc space-y-1 pl-4 marker:text-secondary">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-1 list-decimal space-y-1 pl-4 marker:text-secondary">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-secondary-ink underline decoration-secondary/40 underline-offset-2 hover:decoration-secondary"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h1 className="mt-1 text-[15px] font-semibold text-ink">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-1 text-[13px] font-semibold text-ink">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 text-[13px] font-semibold text-ink">{children}</h3>,
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-[var(--radius-sm)] bg-card-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-card-2 px-1.5 py-0.5 font-mono text-[12px] text-secondary-ink [overflow-wrap:anywhere]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-secondary/40 pl-3 italic text-ink-3">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-hair px-2 py-1 text-left font-medium text-ink">{children}</th>
          ),
          td: ({ children }) => <td className="border border-hair px-2 py-1">{children}</td>,
          hr: () => <hr className="my-3 border-hair" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
