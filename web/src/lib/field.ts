/**
 * One editable number, wherever it lives.
 *
 * A field carries a getter and a setter rather than the name of a property. A
 * name would have to be looked up at runtime, which is both a field that can
 * name something that does not exist and an object indexed by a string — and
 * the compiler can check neither. This way a field that does not belong to the
 * thing it edits will not compile.
 *
 * `min` and `max` restate the engine's own bounds, so a spinner cannot reach a
 * number the simulation refuses. They are not the enforcement: that stays in
 * Go, where every caller meets it.
 */
export interface NumberField<T> {
  label: string;
  hint: string;
  /** Shown after the label in brackets. Empty when the number is a count or a
   *  fraction and a unit would be noise. */
  unit: string;
  min: number;
  max: number;
  step: number;
  get: (subject: T) => number;
  set: (subject: T, value: number) => T;
}

/**
 * The smallest value the engine accepts for a duration it samples from.
 *
 * Service, read and write times are drawn from an exponential distribution
 * whose rate is 1/mean, so a mean of zero is a division by zero and the engine
 * refuses it outright. A spinner has to stop somewhere above it, and a tenth of
 * a millisecond is already faster than anything being modelled here.
 */
export const SMALLEST_MEAN_MS = 0.1;

/** A ceiling for the spinners. Not the engine's limit — the engine's limit is
 *  where a duration stops fitting in a clock, which is nowhere near a number
 *  anyone would type on purpose. */
export const PLENTY_MS = 10_000;
