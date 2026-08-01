"use client";

import { useId } from "react";

import type { Endpoint } from "@/lib/topology";

interface ApiProps {
  readonly endpoints: Endpoint[];
  /**
   * The operations the current load offers, so a row can say when it names
   * traffic nothing sends.
   *
   * Names rather than the operations themselves: what this needs to know is
   * which words are real, and taking the whole workload would be reaching for
   * the shares and the kinds it has no use for.
   */
  readonly operations: string[];
  readonly onChange: (endpoints: Endpoint[]) => void;
}

/** Where a row sits, for labelling one that has nothing else to go on. */
function positionOf(index: number): string {
  return `endpoint ${String(index + 1)}`;
}

/** What to call a row in a label: its name once it has one, its position until
 *  then. Rows are added empty and named afterwards, and every unnamed row
 *  sharing the empty string would give every control on it the same accessible
 *  name as every other row's. */
function calling(endpoint: Endpoint, index: number): string {
  return endpoint.name === "" ? positionOf(index) : endpoint.name;
}

/**
 * The API a service exposes, and what each call costs it.
 *
 * A service used to be one service time, which said that everything it did
 * cost the same. Looking a short code up and writing a new one are the same
 * pool of servers doing two jobs whose costs are nothing like each other, and
 * this is where that gets said.
 *
 * Optional, and the list starts empty. A service that describes no API is a
 * service that costs its mean for everything, which is what every service did
 * before endpoints existed — so an empty list here is a complete answer rather
 * than an unfinished form.
 *
 * The operation is free text with the known names offered beside it, not a
 * select. An endpoint may name traffic this particular run does not send: an
 * API has more endpoints than any one load exercises, and a picker limited to
 * the current workload could not express that. What it does instead is say so,
 * because the other reason a name does not match is a typo — and a typo here
 * is silent, falling back to the service's mean and answering questions about
 * a number nobody chose.
 */
export function Api({ endpoints, operations, onChange }: ApiProps) {
  const known = useId();

  const replace = (index: number, endpoint: Endpoint) => {
    onChange(endpoints.map((existing, at) => (at === index ? endpoint : existing)));
  };

  return (
    <fieldset className="api">
      <legend className="api__legend">What it serves</legend>
      <p className="api__hint">
        The calls this service answers, and what each costs it. Anything not
        named here costs the service time above.
      </p>
      <datalist id={known}>
        {operations.map((operation) => (
          <option key={operation} value={operation} />
        ))}
      </datalist>
      <ul className="api__list">
        {endpoints.map((endpoint, index) => (
          // Keyed by position: the name is what is being edited, and keying on
          // it would remount the input on every keystroke and drop the caret.
          <li className="endpoint" key={index}>
            <input
              className="endpoint__name"
              type="text"
              aria-label={`Name of ${positionOf(index)}`}
              placeholder="GET /{code}"
              value={endpoint.name}
              onChange={(event) => {
                replace(index, { ...endpoint, name: event.target.value });
              }}
            />
            <input
              className="endpoint__operation"
              type="text"
              list={known}
              aria-label={`Operation ${calling(endpoint, index)} serves`}
              placeholder="resolve"
              value={endpoint.operation}
              onChange={(event) => {
                replace(index, { ...endpoint, operation: event.target.value });
              }}
            />
            <input
              className="endpoint__cost"
              type="number"
              aria-label={`Time ${calling(endpoint, index)} takes`}
              min={0}
              step={0.5}
              value={endpoint.meanServiceMs}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) {
                  replace(index, { ...endpoint, meanServiceMs: value });
                }
              }}
            />
            <span className="endpoint__unit">ms</span>
            <button
              type="button"
              className="endpoint__remove"
              aria-label={`Remove ${calling(endpoint, index)}`}
              onClick={() => {
                onChange(endpoints.filter((_, at) => at !== index));
              }}
            >
              ×
            </button>
            {/* Said rather than refused. The engine accepts it, because an API
                describes more than any one load exercises — but the other
                reason a name does not match is a typo, and a typo here is
                silent. */}
            {endpoint.operation !== "" && !operations.includes(endpoint.operation) ? (
              <p className="endpoint__unused">
                Nothing in the current load asks for {endpoint.operation}, so
                this endpoint will not be reached.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="api__add"
        onClick={() => {
          onChange([...endpoints, { name: "", operation: "", meanServiceMs: 1 }]);
        }}
      >
        Add an endpoint
      </button>
    </fieldset>
  );
}
