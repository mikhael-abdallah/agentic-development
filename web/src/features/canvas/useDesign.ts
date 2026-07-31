"use client";

import { useCallback, useMemo, useState } from "react";

import {
  type Design,
  type Position,
  addNode,
  connect,
  disconnect,
  emptyDesign,
  freeSpot,
  moveNode,
  removeNode,
  replaceNode,
  selectNode,
} from "@/lib/design";
import type { DesignNode, NodeKind } from "@/lib/topology";

/**
 * The design being edited, and the edits.
 *
 * Every operation is one of the pure functions in `lib/design`, so what this
 * adds is the `useState` around them and nothing else. That is deliberate: the
 * rules about what a design may be — no circles, no traffic into the client —
 * are testable without a renderer, and a hook that reimplemented any of them
 * would be a second place for them to be true.
 *
 * It lives in the canvas slice because the canvas is where a design is drawn.
 * The page threads it to the other slices rather than them reaching across.
 */
export interface DesignController {
  design: Design;
  /** Adds a component. Without a position it goes wherever there is room —
   *  a click on the palette has no place in mind, and dropping every one of
   *  them on the same point stacks them into a single visible box. */
  add: (kind: NodeKind, at?: Position) => void;
  move: (id: string, at: Position) => void;
  link: (from: string, to: string) => void;
  unlink: (from: string, to: string) => void;
  drop: (id: string) => void;
  select: (id: string | null) => void;
  replace: (node: DesignNode) => void;
  load: (design: Design) => void;
}

export function useDesign(initial?: Design): DesignController {
  const [design, setDesign] = useState<Design>(() => initial ?? emptyDesign());

  const add = useCallback((kind: NodeKind, at?: Position) => {
    setDesign((current) => addNode(current, kind, at ?? freeSpot(current)));
  }, []);
  const move = useCallback((id: string, at: Position) => {
    setDesign((current) => moveNode(current, id, at));
  }, []);
  const link = useCallback((from: string, to: string) => {
    setDesign((current) => connect(current, from, to));
  }, []);
  const unlink = useCallback((from: string, to: string) => {
    setDesign((current) => disconnect(current, from, to));
  }, []);
  const drop = useCallback((id: string) => {
    setDesign((current) => removeNode(current, id));
  }, []);
  const select = useCallback((id: string | null) => {
    setDesign((current) => selectNode(current, id));
  }, []);
  const replace = useCallback((node: DesignNode) => {
    setDesign((current) => replaceNode(current, node));
  }, []);

  return useMemo(
    () => ({ design, add, move, link, unlink, drop, select, replace, load: setDesign }),
    [design, add, move, link, unlink, drop, select, replace],
  );
}
