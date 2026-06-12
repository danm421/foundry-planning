"use client";

import { useState } from "react";
import type { LoadedTemplate } from "./use-launcher-state";

interface Props {
  shared: LoadedTemplate[];
  mine: LoadedTemplate[];
  builtIn: LoadedTemplate[];
  builtInHidden: LoadedTemplate[];
  loadedTemplateId: string | null;
  currentUserId: string;
  onLoad: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onChangeVisibility: (id: string, v: "shared" | "private") => void;
  onDelete: (id: string) => void;
  onDismissBuiltin: (slug: string) => void;
  onRestoreBuiltin: (slug: string) => void;
  onSaveAsNew: () => void;
}

export function TemplatesPanel(props: Props) {
  return (
    <div className="space-y-4 rounded border border-hair bg-card p-4 text-sm">
      <BuiltInSection
        items={props.builtIn}
        hidden={props.builtInHidden}
        loadedId={props.loadedTemplateId}
        onLoad={props.onLoad}
        onDismiss={props.onDismissBuiltin}
        onRestore={props.onRestoreBuiltin}
      />
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
        className="w-full rounded border border-dashed border-hair-2 py-2 text-sm text-ink-3 transition-colors hover:border-accent hover:text-accent"
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
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        {props.title}
      </div>
      {props.items.length === 0 ? (
        <div className="text-xs italic text-ink-4">No templates yet</div>
      ) : (
        <ul className="space-y-0.5">
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
      className={`group flex items-center justify-between rounded px-2 py-1 transition-colors ${
        props.isLoaded
          ? "border-l-2 border-accent bg-card-2 text-ink"
          : "border-l-2 border-transparent text-ink-2 hover:bg-card-2 hover:text-ink"
      }`}
    >
      <button
        type="button"
        onClick={props.onLoad}
        className="flex-1 truncate text-left text-sm"
      >
        {props.template.name}
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label={`More actions for ${props.template.name}`}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-2 py-0.5 text-ink-4 transition-colors hover:bg-card-hover hover:text-ink-2"
        >
          …
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded border border-hair bg-card-2 py-1 text-sm shadow-xl">
            {props.canEdit && (
              <button
                type="button"
                onClick={() => {
                  const next = prompt("New name", props.template.name);
                  if (next && next.trim()) props.onRename(next.trim());
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
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
                className="block w-full px-3 py-1.5 text-left text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
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
                className="block w-full px-3 py-1.5 text-left text-crit transition-colors hover:bg-card-hover"
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

function BuiltInSection(props: {
  items: LoadedTemplate[];
  hidden: LoadedTemplate[];
  loadedId: string | null;
  onLoad: (id: string) => void;
  onDismiss: (slug: string) => void;
  onRestore: (slug: string) => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  if (props.items.length === 0 && props.hidden.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        Starter templates
      </div>
      {props.items.length === 0 ? (
        <div className="text-xs italic text-ink-4">All starters hidden</div>
      ) : (
        <ul className="space-y-0.5">
          {props.items.map((t) => (
            <BuiltInRow
              key={t.id}
              template={t}
              isLoaded={t.id === props.loadedId}
              onLoad={() => props.onLoad(t.id)}
              onHide={() => props.onDismiss(t.slug!)}
            />
          ))}
        </ul>
      )}
      {props.hidden.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="text-[11px] text-ink-4 transition-colors hover:text-ink-2"
          >
            {props.hidden.length} hidden · {showHidden ? "Hide" : "Show"}
          </button>
          {showHidden && (
            <ul className="mt-1 space-y-0.5">
              {props.hidden.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded px-2 py-1 text-ink-4"
                >
                  <span className="flex-1 truncate text-sm">{t.name}</span>
                  <button
                    type="button"
                    onClick={() => props.onRestore(t.slug!)}
                    className="rounded px-2 py-0.5 text-xs text-accent transition-colors hover:bg-card-hover"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BuiltInRow(props: {
  template: LoadedTemplate;
  isLoaded: boolean;
  onLoad: () => void;
  onHide: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li
      className={`group flex items-center justify-between rounded px-2 py-1 transition-colors ${
        props.isLoaded
          ? "border-l-2 border-accent bg-card-2 text-ink"
          : "border-l-2 border-transparent text-ink-2 hover:bg-card-2 hover:text-ink"
      }`}
    >
      <button
        type="button"
        onClick={props.onLoad}
        className="flex-1 truncate text-left text-sm"
      >
        {props.template.name}
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label={`More actions for ${props.template.name}`}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-2 py-0.5 text-ink-4 transition-colors hover:bg-card-hover hover:text-ink-2"
        >
          …
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded border border-hair bg-card-2 py-1 text-sm shadow-xl">
            <button
              type="button"
              onClick={() => {
                props.onHide();
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-ink-2 transition-colors hover:bg-card-hover hover:text-ink"
            >
              Hide
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
