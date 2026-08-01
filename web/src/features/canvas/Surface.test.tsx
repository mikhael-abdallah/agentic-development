import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Surface } from "@/features/canvas/Surface";
import { useDesign } from "@/features/canvas/useDesign";
import { encodeNode } from "@/lib/clipboard";
import { type Design, addNode, connect, emptyDesign } from "@/lib/design";
import { KIND_MIME } from "@/lib/drag";
import { newNode } from "@/lib/topology";

const SOMEWHERE = { x: 40, y: 40 };

/** client -> service -> database. Routed through a service because a client
 *  does not call a database: `connect` refuses that edge, and a fixture built
 *  on a refused edge is a fixture with no edge in it. */
function chain(): Design {
  let design = addNode(emptyDesign(), "service", SOMEWHERE);
  design = addNode(design, "database", SOMEWHERE);
  design = connect(design, "client", "service");
  return connect(design, "service", "database");
}

/** The canvas under a real controller, because the pair is what is worth
 *  testing: a canvas wired to a stub proves only that props exist. */
function Harness({
  initial,
  onEdit = () => undefined,
}: {
  readonly initial?: Design;
  readonly onEdit?: (id: string) => void;
}) {
  const controller = useDesign(initial);
  return <Surface controller={controller} onEdit={onEdit} />;
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
describe("Surface", () => {
  it("draws every component in the design", () => {
    render(<Harness initial={chain()} />);
    expect(screen.getByText("Client")).toBeDefined();
    expect(screen.getByText("Database")).toBeDefined();
  });

  // The rule that nothing sends traffic to the client, expressed as an anchor
  // that is not there to grab rather than as an error after the fact.
  // Asked of the client itself rather than of a count of handles: a count
  // moves whenever the fixture gains a component, and would go on passing for
  // the wrong reason.
  it("gives the client nowhere to receive traffic", () => {
    const { container } = render(<Harness initial={chain()} />);
    const client = container.querySelector('.react-flow__node[data-id="client"]');
    expect(client?.querySelector('[aria-label="outgoing traffic"]')).not.toBeNull();
    expect(client?.querySelector('[aria-label="incoming traffic"]')).toBeNull();
    // And every other component does have one, or the rule would be "no
    // component receives traffic", which is a different and broken canvas.
    expect(screen.getAllByLabelText("incoming traffic")).toHaveLength(2);
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

  // Selecting and choosing to work on a component are the same gesture. The
  // canvas reports the second rather than deciding what it means, because what
  // happens next — the settings coming up over the design — is the page's.
  it("says which component was picked to be worked on", () => {
    const onEdit = vi.fn();
    const { container } = render(<Harness initial={chain()} onEdit={onEdit} />);
    fireEvent.click(container.querySelectorAll(".react-flow__node")[1] ?? container);
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("service");
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

  // What copy and paste do is covered in useClipboard.test.tsx. What is only
  // true here is that the canvas is listening at all — the wiring, which is
  // exactly the part a hook's own tests cannot see.
  it("pastes a component from the clipboard onto the design", () => {
    render(<Harness initial={chain()} />);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => encodeNode(newNode("cache", "cache")) },
    });
    fireEvent(document, event);
    expect(screen.getByText("Cache")).toBeDefined();
  });
});
