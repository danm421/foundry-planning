"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { WallClock } from "@/lib/workspace/types";
import { dropTarget } from "@/lib/workspace/week";

/** How far a press travels before it's a drag, so a plain click still opens the meeting. */
const DRAG_THRESHOLD_PX = 4;

export type DragMode = "move" | "resize";

/** The meeting being dragged, drawn at the times it would drop at. */
export type DragPreview = { id: string; start: WallClock; end: WallClock };

type Press = {
  pointerId: number;
  id: string;
  mode: DragMode;
  event: { start: WallClock; end: WallClock };
  piece: { topMin: number; endMin: number };
  x: number;
  y: number;
  col: number;
  min: number;
  dragging: boolean;
};

/**
 * Pointer dragging for the week grid. A press on a meeting becomes a drag once
 * the pointer has moved a few pixels; from then the element carrying
 * `captureProps` holds pointer capture, so the drag survives the meeting
 * re-rendering into another day's column. Positions are read off the hour
 * grid's box (`gridRef`): `gutterPx` of hour labels, then `days` equal columns,
 * `pxPerMin` down. Times come from `dropTarget`, never from a `Date`.
 */
export function useEventDrag({
  days,
  gutterPx,
  pxPerMin,
  onMove,
}: {
  days: number;
  gutterPx: number;
  pxPerMin: number;
  onMove: (eventId: string, start: WallClock, end: WallClock) => Promise<void>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const justDropped = useRef(false);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  function locate(grid: HTMLElement, clientX: number, clientY: number): { col: number; min: number } {
    const box = grid.getBoundingClientRect();
    const colWidth = (box.width - gutterPx) / days;
    const col = Math.floor((clientX - box.left - gutterPx) / colWidth);
    return { col: Math.min(days - 1, Math.max(0, col)), min: (clientY - box.top) / pxPerMin };
  }

  function dropOf(p: Press, e: PointerEvent) {
    if (!gridRef.current) return null;
    const at = locate(gridRef.current, e.clientX, e.clientY);
    return dropTarget(p.event, p.piece, {
      mode: p.mode,
      days: p.mode === "move" ? at.col - p.col : 0,
      minutes: at.min - p.min,
    });
  }

  /** A meeting's pointerdown: remember the press; it isn't a drag yet. */
  function begin(
    e: PointerEvent,
    mode: DragMode,
    target: { id: string; event: Press["event"]; piece: Press["piece"] },
  ) {
    if (e.button !== 0 || !gridRef.current) return;
    const at = locate(gridRef.current, e.clientX, e.clientY);
    press.current = {
      ...target,
      pointerId: e.pointerId,
      mode,
      x: e.clientX,
      y: e.clientY,
      ...at,
      dragging: false,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    if (!p.dragging) {
      // Released somewhere this never heard about: it's not a press any more.
      if (e.buttons === 0) {
        press.current = null;
        return;
      }
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const next = { id: p.id, ...(dropOf(p, e) ?? p.event) };
    setPreview((prev) => (prev?.start === next.start && prev.end === next.end ? prev : next));
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return;
    press.current = null;
    if (!p.dragging) return; // a click: the meeting's own handler opens it
    const drop = dropOf(p, e);
    setPreview(null);
    // The click a browser may send after the release belongs to the drag.
    justDropped.current = true;
    setTimeout(() => {
      justDropped.current = false;
    }, 0);
    if (drop) void onMove(p.id, drop.start, drop.end);
  }

  function cancel(e: PointerEvent<HTMLElement>) {
    if (press.current?.pointerId !== e.pointerId) return;
    press.current = null;
    setPreview(null);
  }

  /** On a meeting, capture phase: swallow the click that ends a drag. */
  function swallowDropClick(e: MouseEvent) {
    if (!justDropped.current) return;
    e.preventDefault();
    e.stopPropagation();
  }

  return {
    gridRef,
    preview,
    begin,
    swallowDropClick,
    captureProps: {
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  };
}
