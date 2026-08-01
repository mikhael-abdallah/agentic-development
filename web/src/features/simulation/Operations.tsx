"use client";

import { useId } from "react";

import { formatShare } from "@/lib/format";
import { OPERATION_KINDS, type Operation, type OperationKind } from "@/lib/topology";

interface OperationsProps {
  readonly operations: Operation[];
  readonly onChange: (operations: Operation[]) => void;
}

/** A share as a percentage for a spinner, which wants a number rather than
 *  text. The contract carries a fraction, so the two convert at this boundary
 *  and nowhere else. */
function percentOf(share: number): number {
  return Math.round(share * 1000) / 10;
}

function isKind(value: string): value is OperationKind {
  return OPERATION_KINDS.includes(value as OperationKind);
}

/** Where a row sits, for labelling one that has nothing else to go on. */
function positionOf(index: number): string {
  return `operation ${String(index + 1)}`;
}

/**
 * What to call a row in a label.
 *
 * Its name once it has one, and its position until then. A row is added empty
 * and named afterwards, so every label built from the name alone would be the
 * same empty string on every unnamed row — and a screen reader would announce
 * several controls with identical names and no way to tell them apart.
 */
function calling(operation: Operation, index: number): string {
  return operation.name === "" ? positionOf(index) : operation.name;
}

/**
 * What the traffic is asking the design to do.
 *
 * This replaced a single "read fraction" slider, and the difference is what a
 * design can say about itself. `0.95` said that most requests only read; it did
 * not say that the reads are people following a short link and the writes are
 * people making one, which is the thing a reader of the design actually wants
 * to know. A shortener that lists `resolve` and `shorten` has stated its
 * behaviour; one showing 0.95 has left it to be inferred.
 *
 * Rows rather than a table element. There are three controls per operation and
 * a table would put each in a cell with a column header, which is a heavier
 * structure to navigate for what is really a small form repeated a few times.
 *
 * The shares are edited as percentages and stored as fractions. They are not
 * normalised as they are typed — going from two operations to three means
 * passing through a moment where they do not add up, and a form that reflowed
 * every other number under the hand doing the typing would be unusable. The
 * total is shown instead, and `whyNotOffer` refuses the run until it is right.
 */
export function Operations({ operations, onChange }: OperationsProps) {
  const group = useId();
  const total = operations.reduce((sum, operation) => sum + operation.share, 0);

  const replace = (index: number, operation: Operation) => {
    onChange(operations.map((existing, at) => (at === index ? operation : existing)));
  };

  const add = () => {
    // Half of whatever is unclaimed, or a twentieth if the shares already add
    // up — a new row arriving at zero would be one the engine refuses, and the
    // first thing anyone does after adding one is set its share anyway.
    const spare = Math.max(1 - total, 0.05);
    onChange([...operations, { name: "", kind: "read", share: spare / 2 }]);
  };

  return (
    <fieldset className="operations" aria-describedby={`${group}-hint`}>
      <legend className="operations__legend">What the requests ask for</legend>
      <p className="operations__hint" id={`${group}-hint`}>
        Name what this design is actually asked to do. A read may be answered by
        a cache or a replica and a write may not, which is what makes the split
        worth stating rather than assuming.
      </p>
      <ul className="operations__list">
        {operations.map((operation, index) => (
          // Keyed by position, because the name is what is being edited:
          // keying on it would remount the input on every keystroke and drop
          // the caret. The rows are controlled, so removing one redraws the
          // rest from the list rather than leaving stale state behind.
          <li className="operation" key={index}>
            <input
              className="operation__name"
              type="text"
              // Positional, never the name. Labelling a field with the value
              // it exists to change is circular, and it would be empty on the
              // one row where a label matters most.
              aria-label={`Name of ${positionOf(index)}`}
              placeholder="resolve"
              value={operation.name}
              onChange={(event) => {
                replace(index, { ...operation, name: event.target.value });
              }}
            />
            <select
              className="operation__kind"
              aria-label={`What ${calling(operation, index)} does`}
              value={operation.kind}
              onChange={(event) => {
                if (isKind(event.target.value)) {
                  replace(index, { ...operation, kind: event.target.value });
                }
              }}
            >
              {OPERATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "read" ? "reads" : "writes"}
                </option>
              ))}
            </select>
            <input
              className="operation__share"
              type="number"
              aria-label={`Share of traffic for ${calling(operation, index)}`}
              min={0}
              max={100}
              step={1}
              value={percentOf(operation.share)}
              onChange={(event) => {
                const percent = event.target.valueAsNumber;
                if (Number.isFinite(percent)) {
                  replace(index, { ...operation, share: percent / 100 });
                }
              }}
            />
            <span className="operation__unit">%</span>
            <button
              type="button"
              className="operation__remove"
              aria-label={`Remove ${calling(operation, index)}`}
              onClick={() => {
                onChange(operations.filter((_, at) => at !== index));
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="operations__footer">
        <button type="button" className="operations__add" onClick={add}>
          Add an operation
        </button>
        {/* The running total, always, rather than only when it is wrong. A
            number that appears at the moment of a mistake reads as an error
            message; one that is always there is something to aim at. */}
        <p className="operations__total">{formatShare(total)}% of the traffic</p>
      </div>
    </fieldset>
  );
}
