"use client";

import { type ReactNode, useId } from "react";

import {
  CACHE_FIELDS,
  DATABASE_FIELDS,
  LOAD_BALANCER_FIELDS,
  type NumberField,
  SERVICE_FIELDS,
} from "@/features/inspector/fields";
import { algorithmLabel, kindLabel } from "@/lib/describe";
import {
  ALGORITHMS,
  type Algorithm,
  type DesignNode,
  type LoadBalancerParams,
} from "@/lib/topology";

interface RowProps {
  readonly label: string;
  readonly hint: string;
  /** Given the ids to wire itself to the label and the hint. Passed down
   *  rather than assembled here because only the caller knows whether it is
   *  rendering an input or a select. */
  readonly children: (ids: { id: string; describedBy: string }) => ReactNode;
}

/**
 * A labelled control with a sentence under it.
 *
 * The sentence is attached with `aria-describedby` rather than left inside the
 * `<label>`. Inside, it becomes part of the control's accessible name, and a
 * screen reader announces the whole paragraph every time focus lands — the
 * hint stops being a hint and becomes the name of the box.
 */
function Row({ label, hint, children }: RowProps) {
  const id = useId();
  return (
    <div className="inspector__field">
      <label className="inspector__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: `${id}-hint` })}
      <span className="inspector__hint" id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

interface NumberRowProps<P> {
  readonly field: NumberField<P>;
  readonly params: P;
  readonly onParams: (params: P) => void;
}

/**
 * One number on a component.
 *
 * A blank or half-typed box parses as NaN, and passing that on would put the
 * design into a state the engine refuses and the canvas cannot describe. The
 * input is controlled, so an ignored keystroke simply does not take — clumsier
 * than a box you can empty, better than a component whose service time is
 * quietly not a number.
 */
function NumberRow<P>({ field, params, onParams }: NumberRowProps<P>) {
  return (
    <Row label={field.unit === "" ? field.label : `${field.label} (${field.unit})`} hint={field.hint}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          type="number"
          className="inspector__input"
          value={field.get(params)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) {
              onParams(field.set(params, value));
            }
          }}
        />
      )}
    </Row>
  );
}

interface NumbersProps<P> {
  readonly params: P;
  readonly fields: NumberField<P>[];
  readonly onParams: (params: P) => void;
}

function Numbers<P>({ params, fields, onParams }: NumbersProps<P>) {
  return (
    <>
      {fields.map((field) => (
        <NumberRow key={field.label} field={field} params={params} onParams={onParams} />
      ))}
    </>
  );
}

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
            className="inspector__input"
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
      <Numbers params={params} fields={LOAD_BALANCER_FIELDS} onParams={onParams} />
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
        <p className="inspector__hint">
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
          params={node.service}
          fields={SERVICE_FIELDS}
          onParams={(service) => {
            onChange({ ...node, service });
          }}
        />
      );
    case "cache":
      return node.cache === undefined ? null : (
        <Numbers
          params={node.cache}
          fields={CACHE_FIELDS}
          onParams={(cache) => {
            onChange({ ...node, cache });
          }}
        />
      );
    case "database":
      return node.database === undefined ? null : (
        <Numbers
          params={node.database}
          fields={DATABASE_FIELDS}
          onParams={(database) => {
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
        <p className="inspector__hint">Select a component to change what it does.</p>
      ) : (
        <>
          <Row label="Name" hint="What the canvas shows. It has no effect on the simulation.">
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="text"
                className="inspector__input"
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
