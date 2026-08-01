"use client";

import type { DragEvent } from "react";

import { kindBlurb, kindLabel } from "@/lib/describe";
import { KIND_MIME } from "@/lib/drag";
import { NODE_KINDS, type NodeKind } from "@/lib/topology";

interface PaletteProps {
  readonly onAdd: (kind: NodeKind) => void;
}

/**
 * The components a design can be built from.
 *
 * Each is both draggable and a button. Drag is how a design surface is
 * expected to work; the button is how it works with a keyboard, and it is also
 * the path a test can take — a drag that only exists as pointer events is a
 * feature nothing can assert on.
 */
export function Palette({ onAdd }: PaletteProps) {
  const startDrag = (event: DragEvent, kind: NodeKind) => {
    event.dataTransfer.setData(KIND_MIME, kind);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="palette" aria-label="Components">
      <h2 className="palette__title">Components</h2>
      <ul className="palette__list">
        {NODE_KINDS.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              className={`palette__item palette__item--${kind}`}
              draggable
              onDragStart={(event) => {
                startDrag(event, kind);
              }}
              onClick={() => {
                onAdd(kind);
              }}
            >
              <span className="palette__label">{kindLabel(kind)}</span>
              <span className="palette__blurb">{kindBlurb(kind)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="palette__hint">
        Drag one onto the canvas, or click to drop it in the middle. Join two by
        dragging from the right edge of one to the left edge of the next. Copy a
        component you have set up with Ctrl+C and paste it with Ctrl+V.
      </p>
    </aside>
  );
}
