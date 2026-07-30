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
