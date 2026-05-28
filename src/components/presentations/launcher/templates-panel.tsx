"use client";

import { useState } from "react";
import type { LoadedTemplate } from "./use-launcher-state";

interface Props {
  shared: LoadedTemplate[];
  mine: LoadedTemplate[];
  loadedTemplateId: string | null;
  currentUserId: string;
  onLoad: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onChangeVisibility: (id: string, v: "shared" | "private") => void;
  onDelete: (id: string) => void;
  onSaveAsNew: () => void;
}

export function TemplatesPanel(props: Props) {
  return (
    <div className="space-y-3 text-sm">
      <Section
        title="Firm (shared)"
        items={props.shared}
        loadedId={props.loadedTemplateId}
        currentUserId={props.currentUserId}
        onLoad={props.onLoad}
        onRename={props.onRename}
        onChangeVisibility={props.onChangeVisibility}
        onDelete={props.onDelete}
      />
      <Section
        title="Mine (private)"
        items={props.mine}
        loadedId={props.loadedTemplateId}
        currentUserId={props.currentUserId}
        onLoad={props.onLoad}
        onRename={props.onRename}
        onChangeVisibility={props.onChangeVisibility}
        onDelete={props.onDelete}
      />
      <button
        type="button"
        onClick={props.onSaveAsNew}
        className="w-full rounded border border-dashed py-2 text-sm text-gray-600 hover:text-amber-700 hover:border-amber-700"
      >
        + New from current
      </button>
    </div>
  );
}

function Section(props: {
  title: string;
  items: LoadedTemplate[];
  loadedId: string | null;
  currentUserId: string;
  onLoad: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onChangeVisibility: (id: string, v: "shared" | "private") => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        {props.title}
      </div>
      {props.items.length === 0 ? (
        <div className="text-xs text-gray-400 italic">No templates yet</div>
      ) : (
        <ul className="space-y-1">
          {props.items.map((t) => (
            <Row
              key={t.id}
              template={t}
              isLoaded={t.id === props.loadedId}
              canEdit={t.createdByUserId === props.currentUserId}
              onLoad={() => props.onLoad(t.id)}
              onRename={(name) => props.onRename(t.id, name)}
              onChangeVisibility={(v) => props.onChangeVisibility(t.id, v)}
              onDelete={() => props.onDelete(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row(props: {
  template: LoadedTemplate;
  isLoaded: boolean;
  canEdit: boolean;
  onLoad: () => void;
  onRename: (name: string) => void;
  onChangeVisibility: (v: "shared" | "private") => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li
      className={`flex items-center justify-between rounded px-2 py-1 ${
        props.isLoaded ? "bg-amber-50" : "hover:bg-gray-50"
      }`}
    >
      <button
        type="button"
        onClick={props.onLoad}
        className="text-left flex-1 text-sm"
      >
        {props.template.name}
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label={`More actions for ${props.template.name}`}
          onClick={() => setMenuOpen((v) => !v)}
          className="px-2 text-gray-400 hover:text-gray-700"
        >
          …
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 rounded border bg-white py-1 text-sm shadow">
            {props.canEdit && (
              <button
                type="button"
                onClick={() => {
                  const next = prompt("New name", props.template.name);
                  if (next && next.trim()) props.onRename(next.trim());
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-1 text-left hover:bg-gray-50"
              >
                Rename
              </button>
            )}
            {props.canEdit && (
              <button
                type="button"
                onClick={() => {
                  props.onChangeVisibility(
                    props.template.visibility === "shared" ? "private" : "shared",
                  );
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-1 text-left hover:bg-gray-50"
              >
                {props.template.visibility === "shared"
                  ? "Make private"
                  : "Share with firm"}
              </button>
            )}
            {props.canEdit && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${props.template.name}"?`))
                    props.onDelete();
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-1 text-left text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
