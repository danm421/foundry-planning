"use client";

import dynamic from "next/dynamic";

// Defers the tiptap bundle (~487KB: @tiptap/react + starter-kit + prosemirror)
// off the CRM/notes/presentations routes until the editor actually mounts
// inside an open dialog. tiptap touches `window`, so `ssr: false`. The loading
// fallback is sized to the editor (toolbar + min-h-[300px]) so opening the
// dialog doesn't jump when the chunk arrives. The dialog's own open transition
// covers the fetch.
export const RichTextEditor = dynamic(
  () => import("@/components/rich-text-editor").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[340px] w-full animate-pulse rounded bg-hair" aria-hidden />
    ),
  },
);
