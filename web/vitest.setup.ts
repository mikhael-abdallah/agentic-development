import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library unmounts what a test rendered only when vitest runs with
// `globals: true`, which registers its own afterEach hook. This project imports
// its test helpers explicitly instead, so nothing was unmounting anything:
// every render stayed in the document and the next test queried a DOM its
// predecessors had built.
//
// That is invisible while the tests happen to run in a forgiving order, and it
// is what `sequence.shuffle` turned red the first time it ran in CI — one test
// asserting on a heading found two of them, because a sibling had already
// rendered the same page.
afterEach(cleanup);

// React Flow measures the DOM to decide where a node is, and jsdom lays
// nothing out: it has no ResizeObserver at all, and reports every element as
// zero by zero. Without these the canvas throws on mount, which would leave
// the whole design surface untested and its lines uncovered — the outcome the
// coverage gate exists to make visible rather than one to work around.
//
// They are stubs, not a layout engine. What they buy is the ability to assert
// on what the canvas renders and what it does with an event; anything that
// depends on real geometry — where a drop lands, whether two nodes overlap —
// is not testable here and is not tested here.
class StubResizeObserver {
  observe(): void {
    // jsdom never resizes anything; React Flow only needs the API to exist.
  }

  unobserve(): void {
    // As above.
  }

  disconnect(): void {
    // As above.
  }
}

globalThis.ResizeObserver = StubResizeObserver;

Object.defineProperties(globalThis.HTMLElement.prototype, {
  // One pixel rather than zero: React Flow treats a zero-sized pane as not yet
  // mounted and declines to render anything into it.
  offsetWidth: { get: () => 1 },
  offsetHeight: { get: () => 1 },
});
