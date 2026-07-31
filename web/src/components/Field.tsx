"use client";

import { type ReactNode, useId } from "react";

import type { NumberField } from "@/lib/field";

interface RowProps {
  readonly label: string;
  readonly hint: string;
  /** Given the ids to wire itself to the label and the hint. Passed down
   *  rather than assembled here because only the caller knows whether it is
   *  rendering an input, a select or something else. */
  readonly children: (ids: { id: string; describedBy: string }) => ReactNode;
}

/**
 * A labelled control with a sentence under it.
 *
 * The sentence is attached with `aria-describedby` rather than left inside the
 * `<label>`. Inside, it becomes part of the control's accessible name and a
 * screen reader announces the whole paragraph every time focus lands — the
 * hint stops being a hint and becomes the name of the box.
 */
export function Row({ label, hint, children }: RowProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy: `${id}-hint` })}
      <span className="field__hint" id={`${id}-hint`}>
        {hint}
      </span>
    </div>
  );
}

interface NumberRowProps<T> {
  readonly field: NumberField<T>;
  readonly subject: T;
  readonly onChange: (subject: T) => void;
}

/**
 * One number.
 *
 * A blank or half-typed box parses as NaN, and passing that on would put the
 * design into a state the engine refuses and nothing on screen can describe.
 * The input is controlled, so an ignored keystroke simply does not take —
 * clumsier than a box you can empty, better than a service time that is
 * quietly not a number.
 */
function NumberRow<T>({ field, subject, onChange }: NumberRowProps<T>) {
  return (
    <Row
      label={field.unit === "" ? field.label : `${field.label} (${field.unit})`}
      hint={field.hint}
    >
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          type="number"
          className="field__input"
          value={field.get(subject)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) {
              onChange(field.set(subject, value));
            }
          }}
        />
      )}
    </Row>
  );
}

interface NumbersProps<T> {
  readonly subject: T;
  readonly fields: NumberField<T>[];
  readonly onChange: (subject: T) => void;
}

export function Numbers<T>({ subject, fields, onChange }: NumbersProps<T>) {
  return (
    <>
      {fields.map((field) => (
        <NumberRow key={field.label} field={field} subject={subject} onChange={onChange} />
      ))}
    </>
  );
}
