import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignCanvas } from "@/features/canvas/DesignCanvas";
import { useDesign } from "@/features/canvas/useDesign";
import { type Design, addNode, connect, emptyDesign } from "@/lib/design";
import { KIND_MIME } from "@/lib/drag";

const SOMEWHERE = { x: 40, y: 40 };

function chain(): Design {
  const design = addNode(emptyDesign(), "database", SOMEWHERE);
  return connect(design, "client", "database");
}

/** The canvas under a real controller, because the pair is what is worth
 *  testing: a canvas wired to a stub proves only that props exist. */
function Harness({ initial }: { readonly initial?: Design }) {
  const controller = useDesign(initial);
  return <DesignCanvas controller={controller} />;
}

function paneOf(container: HTMLElement): Element {
  const pane = container.querySelector(".react-flow__pane");
  if (pane === null) {
    throw new Error("the canvas rendered without a pane");
  }
  return pane;
}

function dropKind(container: HTMLElement, kind: string): void {
  fireEvent.drop(container.querySelector(".canvas") ?? container, {
    clientX: 100,
    clientY: 100,
    dataTransfer: { getData: (type: string) => (type === KIND_MIME ? kind : "") },
  });
}

// What is not tested here, and why: React Flow decides where an edge is drawn
// and which node a pointer is over from measured geometry, and jsdom measures
// nothing. So connecting two components by dragging a handle, deleting with
// Backspace, and the position updates a drag produces are all beyond this
// file. The decisions behind them — which edges are legal, what removing a
// component does to its edges — are pure functions in lib/design and are
// covered there.
describe("DesignCanvas", () => {
  it("draws every component in the design", () => {
    render(<Harness initial={chain()} />);
    expect(screen.getByText("Client")).toBeDefined();
    expect(screen.getByText("Database")).toBeDefined();
  });

  // The rule that nothing sends traffic to the client, expressed as an anchor
  // that is not there to grab rather than as an error after the fact.
  it("gives the client nowhere to receive traffic", () => {
    render(<Harness initial={chain()} />);
    expect(screen.getAllByLabelText("outgoing traffic")).toHaveLength(2);
    expect(screen.getAllByLabelText("incoming traffic")).toHaveLength(1);
  });

  it("adds a component dropped from the palette", () => {
    const { container } = render(<Harness />);
    dropKind(container, "cache");
    expect(screen.getByText("Cache")).toBeDefined();
  });

  // Anything can be dragged into a browser window. Something that is not a
  // component kind has to land as nothing, not as a component with no kind.
  it("ignores a drop that is not a component", () => {
    const { container } = render(<Harness />);
    dropKind(container, "a file from the desktop");
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(1);
  });

  it("accepts the drag while it is over the canvas", () => {
    const { container } = render(<Harness />);
    const dataTransfer = { dropEffect: "none" };
    fireEvent.dragOver(container.querySelector(".canvas") ?? container, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("selects the component that was clicked", () => {
    const { container } = render(<Harness initial={chain()} />);
    const nodes = container.querySelectorAll(".react-flow__node");
    fireEvent.click(nodes[1] ?? container);
    expect(container.querySelectorAll('.component[data-selected="true"]')).toHaveLength(1);
  });

  it("clears the selection when the canvas itself is clicked", () => {
    const { container } = render(<Harness initial={chain()} />);
    fireEvent.click(container.querySelectorAll(".react-flow__node")[1] ?? container);
    fireEvent.click(paneOf(container));
    expect(container.querySelectorAll('.component[data-selected="true"]')).toHaveLength(0);
  });

  // An edge that silently fails to appear reads as a broken canvas. The reason
  // goes into a live region so it reaches a screen reader too.
  it("has somewhere to say why a connection was refused", () => {
    render(<Harness initial={chain()} />);
    expect(screen.getByRole("status")).toBeDefined();
  });
});
