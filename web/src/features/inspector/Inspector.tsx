"use client";

import { Numbers, Row } from "@/components/Field";
import { Api } from "@/features/inspector/Api";
import { Schema } from "@/features/inspector/Schema";
import {
  CACHE_FIELDS,
  DATABASE_FIELDS,
  LOAD_BALANCER_FIELDS,
  SCAN_FIELDS,
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
  type DatabaseParams,
  type DesignNode,
  type Endpoint,
  type LoadBalancerParams,
  type Query,
  type ServiceParams,
  type Table,
  WRITE_POLICIES,
  type WritePolicy,
} from "@/lib/topology";

interface StoreProps {
  readonly params: DatabaseParams;
  readonly operations: string[];
  readonly onParams: (params: DatabaseParams) => void;
}

/**
 * A store, and the schema it answers from.
 *
 * The scan rate appears only once there is a schema, because it is only then
 * that there are rows to convert into time. Asking for it on every database
 * would be asking for a number for an arithmetic nobody had requested — and it
 * deliberately has no default, so a blank one is a design the engine refuses
 * rather than a design carrying a plausible figure this app invented.
 *
 * Emptying the schema takes all three keys with it, for the same reason
 * emptying a service's API takes its key: absent and empty read the same to the
 * engine and the clipboard, so leaving them behind would make a copy that is
 * not equal to what was copied while behaving identically.
 */
function Store({ params, operations, onParams }: StoreProps) {
  const setSchema = (schema: { tables: Table[]; queries: Query[] }) => {
    if (schema.tables.length === 0 && schema.queries.length === 0) {
      onParams({
        replicas: params.replicas,
        meanReadMs: params.meanReadMs,
        meanWriteMs: params.meanWriteMs,
        poolSize: params.poolSize,
      });
      return;
    }
    onParams({ ...params, ...schema, scanPerMillionRowsMs: params.scanPerMillionRowsMs ?? 0 });
  };
  const described = (params.tables ?? []).length > 0 || (params.queries ?? []).length > 0;
  return (
    <>
      <Numbers subject={params} fields={DATABASE_FIELDS} onChange={onParams} />
      {described ? <Numbers subject={params} fields={SCAN_FIELDS} onChange={onParams} /> : null}
      <Schema
        tables={params.tables ?? []}
        queries={params.queries ?? []}
        operations={operations}
        onChange={setSchema}
      />
    </>
  );
}

interface ServiceProps {
  readonly params: ServiceParams;
  readonly operations: string[];
  readonly onParams: (params: ServiceParams) => void;
}

/**
 * A pool of servers, and the API it answers.
 *
 * Emptying the list takes the key with it rather than leaving `endpoints: []`.
 * The engine reads the two the same way and so does the clipboard — absent and
 * empty both mean "this service does not describe its API" — so leaving an
 * empty list behind would make deleting the last endpoint and then copying the
 * component produce something that is not equal to what was copied, while
 * behaving identically. Equal is worth more than equivalent here: it is what a
 * round trip can check.
 */
function Service({ params, operations, onParams }: ServiceProps) {
  const setEndpoints = (endpoints: Endpoint[]) => {
    if (endpoints.length > 0) {
      onParams({ ...params, endpoints });
      return;
    }
    // Rebuilt field by field rather than spread-and-delete, so that a required
    // parameter added to the contract fails to compile here instead of being
    // silently dropped the first time someone empties an API.
    onParams({
      instances: params.instances,
      meanServiceMs: params.meanServiceMs,
      queueCapacity: params.queueCapacity,
    });
  };
  return (
    <>
      <Numbers subject={params} fields={SERVICE_FIELDS} onChange={onParams} />
      <Api endpoints={params.endpoints ?? []} operations={operations} onChange={setEndpoints} />
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
  readonly operations: string[];
  readonly onChange: (node: DesignNode) => void;
}

/**
 * The parameters of whichever kind this is.
 *
 * A switch, so adding a kind to the contract fails to compile until it has an
 * editor — the alternative being a component you can select and not change,
 * which reads as a broken panel rather than a missing one.
 */
function Params({ node, operations, onChange }: ParamsProps) {
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
        <Service
          params={node.service}
          operations={operations}
          onParams={(service) => {
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
        <Store
          params={node.database}
          operations={operations}
          onParams={(database) => {
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
  /** The names of the operations the current load offers, so a service's API
   *  can say when an endpoint names traffic nothing sends. */
  readonly operations: string[];
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
export function Inspector({ node, operations, wiring, onChange, onRemove }: InspectorProps) {
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
          <Params node={node} operations={operations} onChange={onChange} />
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
