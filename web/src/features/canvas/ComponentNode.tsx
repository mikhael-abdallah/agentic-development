"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";

import type { ComponentNode as ComponentNodeType } from "@/features/canvas/graph";

/**
 * One component on the canvas.
 *
 * The client gets no target handle, because nothing sends traffic to it —
 * the same rule `whyNotConnect` enforces, expressed here as an anchor that is
 * not there to grab. A rule enforced twice is one a user meets before they
 * break it rather than after.
 */
export function ComponentNode({ data, selected }: NodeProps<ComponentNodeType>) {
  return (
    <div className={`component component--${data.kind}`} data-selected={selected}>
      {data.kind === "client" ? null : (
        <Handle type="target" position={Position.Left} aria-label="incoming traffic" />
      )}
      <span className="component__kind">{data.kind}</span>
      <span className="component__name">{data.name}</span>
      <span className="component__summary">{data.summary}</span>
      <Handle type="source" position={Position.Right} aria-label="outgoing traffic" />
    </div>
  );
}
