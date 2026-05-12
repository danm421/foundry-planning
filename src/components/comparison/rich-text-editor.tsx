"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
}

export function RichTextEditor({ value, onChange, editable = true, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, linkify: false, breaks: true })],
    content: value || "",
    editable,
    onUpdate({ editor }) {
      const md = ((editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
      onChange(md);
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    const currentMd = ((editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
    if (currentMd === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div className="flex h-full flex-col">
      {editable && <Toolbar editor={editor} />}
      <div className="flex-1 overflow-auto">
        <EditorContent
          editor={editor}
          className="prose prose-invert prose-sm min-h-[300px] max-w-none p-4 focus:outline-none [&_*]:!my-2 [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-none"
          aria-placeholder={placeholder}
        />
      </div>
    </div>
  );
}

const BTN =
  "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-amber-400 hover:text-amber-200 disabled:opacity-50";
const BTN_ACTIVE = "border-amber-400 bg-slate-800 text-amber-200";

function Toolbar({ editor }: { editor: Editor }) {
  const blockValue =
    editor.isActive("heading", { level: 1 }) ? "h1"
    : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3"
    : "p";

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-950 px-3 py-2">
      <select
        aria-label="Block format"
        className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-xs text-slate-200"
        value={blockValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") editor.chain().focus().setParagraph().run();
          else if (v === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
          else if (v === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
          else if (v === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <button type="button" className={`${BTN} ${editor.isActive("bulletList") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
      <button type="button" className={`${BTN} ${editor.isActive("orderedList") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
      <span className="mx-1 h-4 w-px bg-slate-800" aria-hidden />
      <button type="button" className={`${BTN} font-semibold ${editor.isActive("bold") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
      <button type="button" className={`${BTN} italic ${editor.isActive("italic") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
      <button type="button" className={`${BTN} ${editor.isActive("blockquote") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</button>
      <button type="button" className={`${BTN} ${editor.isActive("code") ? BTN_ACTIVE : ""}`} onClick={() => editor.chain().focus().toggleCode().run()}>{"<>"}</button>
    </div>
  );
}
