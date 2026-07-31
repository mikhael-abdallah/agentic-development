"use client";

import { Numbers, Row } from "@/components/Field";
import {
  CACHE_FIELDS,
  DATABASE_FIELDS,
  LOAD_BALANCER_FIELDS,
  SERVICE_FIELDS,
} from "@/features/inspector/fields";
import {
  type Contract,
  algorithmLabel,
  kindBlurb,
  kindLabel,
  writePolicyBlurb,
  writePolicyLabel,
} from "@/lib/describe";
import {
  ALGORITHMS,
  type Algorithm,
  type CacheParams,
  type DesignNode,
  type LoadBalancerParams,
  WRITE_POLICIES,
  type WritePolicy,
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

interface CacheProps {
  readonly params: CacheParams;
  readonly onParams: (params: CacheParams) => void;
}

/**
 * A cache is a hit ratio, a lookup cost, and one decision.
 *
 * The decision gets its own control and its own paragraph because it is the
 * only parameter here whose cost the simulator does not measure. Two of the
 * three policies buy their speed with something no number on this screen
 * moves — staleness, and a lost acknowledged write — so the panel says which,
 * and says it next to the choice rather than in documentation.
 */
function Cache({ params, onParams }: CacheProps) {
  const policy = params.writePolicy;
  return (
    <>
      <Numbers subject={params} fields={CACHE_FIELDS} onChange={onParams} />
      <Row
        label="Writes"
        hint="A read is what a cache is for, and the hit ratio settles it. A write has to reach the store, so the only question is what the cache does on the way."
      >
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            className="field__input"
            value={policy}
            onChange={(event) => {
              onParams({ ...params, writePolicy: event.target.value as WritePolicy });
            }}
          >
            {WRITE_POLICIES.map((option) => (
              <option key={option} value={option}>
                {writePolicyLabel(option)}
              </option>
            ))}
          </select>
        )}
      </Row>
      <p className="field__hint">{writePolicyBlurb(policy)}</p>
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
        <Cache
          params={node.cache}
          onParams={(cache) => {
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

interface WiringProps {
  readonly title: string;
  readonly empty: string;
  readonly contracts: Contract[];
}

/**
 * One side of a component's wiring, and what crosses it.
 *
 * Shown even when there is nothing on that side: "nothing sends to this yet"
 * is the sentence someone needs when their design will not run, and an absent
 * list says the same thing only to whoever already suspected it.
 */
function Wiring({ title, empty, contracts }: WiringProps) {
  return (
    <div className="wiring">
      <p className="wiring__title">{title}</p>
      {contracts.length === 0 ? (
        <p className="field__hint">{empty}</p>
      ) : (
        <ul className="wiring__list">
          {contracts.map((contract) => (
            <li key={contract.id} className="wiring__item">
              <span className="wiring__other">{contract.other}</span>
              <span className="wiring__carries">{contract.carries}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface InspectorProps {
  readonly node: DesignNode | undefined;
  /** What reaches this component and what it passes on. Derived from the
   *  design's own edges rather than from the kind, because what a database is
   *  handed depends on whether a cache sits in front of it. */
  readonly wiring: { incoming: Contract[]; outgoing: Contract[] };
  readonly onChange: (node: DesignNode) => void;
  readonly onRemove: (id: string) => void;
}

/**
 * The selected component's parameters, and what each one does to the answer.
 *
 * The heading names the component rather than saying "Parameters", and the
 * line above it says whose parameters they are. Three panels sit in this
 * column drawing identical rows of numbers, and without that, a queue capacity
 * and an arrival rate look like two settings of the same thing — one of which
 * would silently belong to a component nobody remembers selecting.
 */
export function Inspector({ node, wiring, onChange, onRemove }: InspectorProps) {
  return (
    <aside className="panel inspector" aria-label="Component settings" data-kind={node?.kind}>
      <p className="panel__scope">Selected component</p>
      <h2 className="panel__title">
        {node === undefined ? "Nothing selected" : (node.label ?? kindLabel(node.kind))}
      </h2>
      {node === undefined ? (
        <p className="field__hint">Select a component on the canvas to change what it does.</p>
      ) : (
        <>
          <p className="panel__kind">{kindBlurb(node.kind)}</p>
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
          <Wiring
            title="Receives"
            empty="Nothing sends to this yet — it will not be reached by a run."
            contracts={wiring.incoming}
          />
          <Wiring
            title="Sends on"
            empty="Nothing behind it. Requests that reach here end here."
            contracts={wiring.outgoing}
          />
          <button
            type="button"
            className="inspector__remove"
            onClick={() => {
              onRemove(node.id);
            }}
          >
            Remove this component
          </button>
        </>
      )}
    </aside>
  );
}
