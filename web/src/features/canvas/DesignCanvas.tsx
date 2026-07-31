"use client";

import {
  Background,
  Controls,
  type Edge,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { type DragEvent, useCallback, useMemo, useState } from "react";

import { ComponentNode } from "@/features/canvas/ComponentNode";
import {
  type ComponentNode as ComponentNodeType,
  applyEdits,
  editsFromEdgeChanges,
  editsFromNodeChanges,
  toFlowEdges,
  toFlowNodes,
} from "@/features/canvas/graph";
import type { DesignController } from "@/features/canvas/useDesign";
import { whyNotConnect } from "@/lib/design";
import { KIND_MIME } from "@/lib/drag";
import { NODE_KINDS, type NodeKind } from "@/lib/topology";

import "@xyflow/react/dist/style.css";

// Outside the component, because React Flow remounts every node when this
// object changes identity — which, defined inline, is every render.
const NODE_TYPES = { component: ComponentNode };

function isKind(value: string): value is NodeKind {
  return NODE_KINDS.includes(value as NodeKind);
}

interface SurfaceProps {
  readonly controller: DesignController;
}

function Surface({ controller }: SurfaceProps) {
  const { design, add, move, link, unlink, drop, select } = controller;
  const { screenToFlowPosition } = useReactFlow();
  // Why the last connection was refused. Shown rather than swallowed: an edge
  // that silently fails to appear reads as a broken canvas.
  const [refusal, setRefusal] = useState<string | null>(null);

  const nodes = useMemo(() => toFlowNodes(design), [design]);
  const edges = useMemo(() => toFlowEdges(design.topology), [design.topology]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ComponentNodeType>[]) => {
      applyEdits(editsFromNodeChanges(changes), { move, drop, unlink });
    },
    [move, drop, unlink],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      applyEdits(editsFromEdgeChanges(changes, design.topology), { move, drop, unlink });
    },
    [design.topology, move, drop, unlink],
  );

  // React Flow also takes an `isValidConnection`, which greys out the handles a
  // connection cannot land on. It is deliberately not used, and the reason is
  // worth stating: supplying it makes the library drop an invalid connection
  // itself, so `onConnect` never sees one and the refusal below could only ever
  // be set to null — a live region that exists to explain a refusal and never
  // holds a word. Between saying why an edge was refused and greying out a
  // handle without saying why, this app is about the why.
  const onConnect = useCallback(
    (connection: { source: string; target: string }) => {
      const reason = whyNotConnect(design, connection.source, connection.target);
      setRefusal(reason);
      if (reason === null) {
        link(connection.source, connection.target);
      }
    },
    [design, link],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDropped = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(KIND_MIME);
      if (!isKind(kind)) {
        return;
      }
      add(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [add, screenToFlowPosition],
  );

  return (
    <div className="canvas" onDrop={onDropped} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          select(node.id);
        }}
        onPaneClick={() => {
          select(null);
          setRefusal(null);
        }}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <p className="canvas__refusal" role="status">
        {refusal}
      </p>
    </div>
  );
}

/**
 * The design surface.
 *
 * The provider is here rather than in the page because `screenToFlowPosition`
 * — the one thing that turns a drop somewhere on screen into a position in the
 * design — only exists inside it, and a page that had to know that would know
 * something about the canvas that is none of its business.
 */
export function DesignCanvas({ controller }: SurfaceProps) {
  return (
    <ReactFlowProvider>
      <Surface controller={controller} />
    </ReactFlowProvider>
  );
}
