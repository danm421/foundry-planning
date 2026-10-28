"use client";

// Drag-to-reorder for the observation and next-step lists. The order dragged
// here is the `sortOrder` the deck's Observations & Next Steps page and the
// Plan Story print in, so the Details panel and the deck's authoring panel
// share this one control.
import { useId, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Puts the rows named in `orderedIds` back into the slots they held, in the
 *  new order; every other row keeps its place. One topic group (or the
 *  not-done steps) reorders without disturbing the rows around it. */
export function placeInOrder<T extends { id: string }>(rows: T[], orderedIds: string[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const queue = orderedIds.flatMap((id) => byId.get(id) ?? []);
  const moving = new Set(orderedIds);
  return rows.map((r) => (moving.has(r.id) ? queue.shift()! : r));
}

/** Keeps a dragged row in its column and inside the box that scrolls it (the
 *  page, or the Options dialog's body). A row let past that box's edge makes
 *  the box taller, so auto-scroll never reaches the end — the row ran away
 *  into blank space. */
export const keepInScrollArea: Modifier = ({ transform, draggingNodeRect, scrollableAncestorRects }) => {
  const area = scrollableAncestorRects[0];
  if (!draggingNodeRect || !area) return { ...transform, x: 0 };
  const y = Math.min(Math.max(transform.y, area.top - draggingNodeRect.top), area.bottom - draggingNodeRect.bottom);
  return { ...transform, x: 0, y };
};

export function SortableRows({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
}) {
  // A stable id keeps dnd-kit's screen-reader ids the same on the server and
  // the client — its own counter differs between the two and breaks hydration.
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[keepInScrollArea]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** A list row with a grip at its left edge. A mouse drag can start anywhere on
 *  the row (a click that doesn't move still presses the row's buttons); a
 *  keyboard drag and a touch drag start only from the grip, so Space on the
 *  row's own buttons and swiping to scroll keep working. */
export function SortableRow({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    // Translate, not Transform: rows differ in height, and the scale dnd-kit
    // adds squashes the dragged row to fit each slot it passes.
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} className={`${className} cursor-grab active:cursor-grabbing`} {...listeners}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="mt-0.5 flex-shrink-0 touch-none rounded text-ink-4 opacity-60 transition-opacity hover:text-ink-2 focus-visible:opacity-100 group-hover:opacity-100"
        {...attributes}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="4" r="1.2" /><circle cx="11" cy="4" r="1.2" />
          <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
          <circle cx="5" cy="12" r="1.2" /><circle cx="11" cy="12" r="1.2" />
        </svg>
      </button>
      {children}
    </li>
  );
}
