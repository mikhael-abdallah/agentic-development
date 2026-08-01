"use client";

import dynamic from "next/dynamic";

import type { DesignController } from "@/features/canvas/useDesign";

/**
 * The design surface, fetched when the page has one to draw.
 *
 * `@xyflow/react` and the code around it are about 50 kB gzipped — a fifth of
 * everything this app ships and more than every panel put together. Loading it
 * with the page put the first load within a rounding error of the 244 kB gate,
 * which meant the next thing anyone wanted to add to any panel would not fit,
 * and the only remaining move would have been to raise the budget. Splitting it
 * out is the honest version of that: the same code arrives, a moment later,
 * off the critical path.
 *
 * `ssr: false` because the surface has nothing to render before it is in a
 * browser. It measures boxes and reads pointer positions; a prerender of it
 * would be markup that is thrown away on the first frame.
 */
const Surface = dynamic(
  async () => {
    const canvas = await import("@/features/canvas/Surface");
    return canvas.Surface;
  },
  {
    ssr: false,
    // Not a spinner. This is a shape holding the space the canvas is about to
    // fill, and a sentence saying so, because the panels either side of it
    // render immediately and an empty middle reads as a canvas that failed.
    loading: () => (
      <div className="canvas canvas--loading">
        <p className="canvas__loading">Bringing up the design surface…</p>
      </div>
    ),
  },
);

interface DesignCanvasProps {
  readonly controller: DesignController;
  readonly onEdit: (id: string) => void;
}

export function DesignCanvas({ controller, onEdit }: DesignCanvasProps) {
  return <Surface controller={controller} onEdit={onEdit} />;
}
