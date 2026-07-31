"use client";

import { Numbers, Row } from "@/components/Field";
import {
  CACHE_FIELDS,
  DATABASE_FIELDS,
  LOAD_BALANCER_FIELDS,
  SERVICE_FIELDS,
} from "@/features/inspector/fields";
import { algorithmLabel, kindLabel } from "@/lib/describe";
import {
  ALGORITHMS,
  type Algorithm,
  type DesignNode,
  type LoadBalancerParams,
} from "@/lib/topology";

interface BalancerProps {
  readonly params: LoadBalancerParams;
  readonly onParams: (params: LoadBalancerParams) => void;
}

/** A balancer is the one component with a choice on it rather than only
 *  numbers, so it gets its own editor rather than a special case in the
 *  switch below. */
function Balancer({ params, onParams }: BalancerProps) {
  return (
    <>
      <Row
        label="Strategy"
        hint="They differ only when service times are uneven, which is exactly when the choice matters."
      >
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className="field__input"
            value={params.algorithm}
            onChange={(event) => {
              onParams({ ...params, algorithm: event.target.value as Algorithm });
            }}
          >
            {ALGORITHMS.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {algorithmLabel(algorithm)}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Numbers subject={params} fields={LOAD_BALANCER_FIELDS} onChange={onParams} />
    </>
  );
}

interface ParamsProps {
  readonly node: DesignNode;
  readonly onChange: (node: DesignNode) => void;
}

/**
 * The parameters of whichever kind this is.
 *
 * A switch, so adding a kind to the contract fails to compile until it has an
 * editor — the alternative being a component you can select and not change,
 * which reads as a broken panel rather than a missing one.
 */
function Params({ node, onChange }: ParamsProps) {
  switch (node.kind) {
    case "client":
      return (
        <p className="field__hint">
          The client offers the load. What it sends is the workload, not a
          property of the component.
        </p>
      );
    case "loadBalancer":
      return node.loadBalancer === undefined ? null : (
        <Balancer
          params={node.loadBalancer}
          onParams={(loadBalancer) => {
            onChange({ ...node, loadBalancer });
          }}
        />
      );
    case "service":
      return node.service === undefined ? null : (
        <Numbers
          subject={node.service}
          fields={SERVICE_FIELDS}
          onChange={(service) => {
            onChange({ ...node, service });
          }}
        />
      );
    case "cache":
      return node.cache === undefined ? null : (
        <Numbers
          subject={node.cache}
          fields={CACHE_FIELDS}
          onChange={(cache) => {
            onChange({ ...node, cache });
          }}
        />
      );
    case "database":
      return node.database === undefined ? null : (
        <Numbers
          subject={node.database}
          fields={DATABASE_FIELDS}
          onChange={(database) => {
            onChange({ ...node, database });
          }}
        />
      );
  }
}

interface InspectorProps {
  readonly node: DesignNode | undefined;
  readonly onChange: (node: DesignNode) => void;
}

/** The selected component's parameters, and what each one does to the answer. */
export function Inspector({ node, onChange }: InspectorProps) {
  return (
    <aside className="inspector" aria-label="Parameters">
      <h2 className="inspector__title">Parameters</h2>
      {node === undefined ? (
        <p className="field__hint">Select a component to change what it does.</p>
      ) : (
        <>
          <Row label="Name" hint="What the canvas shows. It has no effect on the simulation.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                className="field__input"
                value={node.label ?? ""}
                placeholder={kindLabel(node.kind)}
                onChange={(event) => {
                  onChange({ ...node, label: event.target.value });
                }}
              />
            )}
          </Row>
          <Params node={node} onChange={onChange} />
        </>
      )}
    </aside>
  );
}
