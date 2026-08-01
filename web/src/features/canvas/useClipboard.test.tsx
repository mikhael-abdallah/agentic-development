import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useClipboard } from "@/features/canvas/useClipboard";
import { useDesign } from "@/features/canvas/useDesign";
import { encodeNode } from "@/lib/clipboard";
import { type Design, addNode, emptyDesign, selectNode } from "@/lib/design";
import { newNode } from "@/lib/topology";

const SOMEWHERE = { x: 40, y: 40 };

/** A design with a tuned service selected, so a copy that came back carrying
 *  defaults would be visible rather than plausible. */
function withService(): Design {
  const design = addNode(emptyDesign(), "service", SOMEWHERE);
  return selectNode(design, "service");
}

/**
 * The hook over a real controller, with the design listed as text.
 *
 * A real controller rather than a stub `paste`, because what is worth checking
 * is that a keystroke ends in a component: a spy proves the hook calls a
 * function, which is the part that was never in doubt. The input is here so a
 * test can press the keys from inside a form field, which is where the settings
 * dialog puts them.
 */
function Harness({ initial }: { readonly initial?: Design }) {
  const controller = useDesign(initial);
  const { design, paste } = controller;
  useClipboard(
    design.topology.nodes.find((node) => node.id === design.selected),
    paste,
  );
  return (
    <div>
      <p>{design.topology.nodes.map((node) => node.id).join(" ")}</p>
      <input aria-label="Instances" defaultValue="4" />
    </div>
  );
}

/**
 * A clipboard event carrying `text`.
 *
 * Built by hand because jsdom has neither `ClipboardEvent` nor `DataTransfer`
 * — it is a DOM without a clipboard. What the handlers touch is `clipboardData`
 * and `preventDefault`, so those are what this provides; nothing here pretends
 * to be the browser's clipboard, and the gesture itself is checked in one.
 */
function clipboardEvent(type: "copy" | "paste", text = "") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const clipboardData = { getData: () => text, setData: vi.fn() };
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  return { event, clipboardData };
}

function ids(): string[] {
  return screen.getByText(/client/).textContent.split(" ");
}

describe("useClipboard copying", () => {
  it("writes the selected component to the clipboard", () => {
    render(<Harness initial={withService()} />);
    const { event, clipboardData } = clipboardEvent("copy");
    fireEvent(document, event);
    expect(clipboardData.setData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
      encodeNode(newNode("service", "service")),
    );
    expect(event.defaultPrevented).toBe(true);
  });

  // Ctrl+C with nothing chosen has to leave the clipboard holding whatever it
  // held. Preventing the default before deciding there was something to write
  // would be a copy that empties the clipboard instead of filling it.
  it("leaves the clipboard alone when nothing is selected", () => {
    render(<Harness />);
    const { event, clipboardData } = clipboardEvent("copy");
    fireEvent(document, event);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // The settings dialog is full of number fields, and Ctrl+C in one of them
  // means copy this number. Answering the same keystroke differently depending
  // on where focus is is not a special case: it is what the browser has always
  // done, and a handler on the document is what would break it.
  it("leaves a copy from inside a form field to the browser", () => {
    render(<Harness initial={withService()} />);
    const { event, clipboardData } = clipboardEvent("copy");
    fireEvent(screen.getByLabelText("Instances"), event);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a copy of selected text to the browser", () => {
    render(<Harness initial={withService()} />);
    const selection = { toString: () => "some words on the page" } as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(selection);
    const { event, clipboardData } = clipboardEvent("copy");
    fireEvent(document, event);
    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("useClipboard pasting", () => {
  it("adds a copy of the component on the clipboard", () => {
    render(<Harness initial={withService()} />);
    const { event } = clipboardEvent("paste", encodeNode(newNode("service", "service")));
    fireEvent(document, event);
    expect(ids()).toEqual(["client", "service", "service-2"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("pastes as many copies as it is asked for", () => {
    render(<Harness initial={withService()} />);
    const text = encodeNode(newNode("cache", "cache"));
    fireEvent(document, clipboardEvent("paste", text).event);
    fireEvent(document, clipboardEvent("paste", text).event);
    expect(ids()).toEqual(["client", "service", "cache", "cache-2"]);
  });

  // Ctrl+V over a canvas when the clipboard holds a sentence has to do what it
  // does anywhere else: nothing this app can see. The alternative — a buffer
  // held in the page — would paste a component the user copied ten minutes and
  // three other copies ago.
  it("leaves text that is not a component to the browser", () => {
    render(<Harness initial={withService()} />);
    const { event } = clipboardEvent("paste", "the quick brown fox");
    fireEvent(document, event);
    expect(ids()).toEqual(["client", "service"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a paste into a form field to the browser", () => {
    render(<Harness initial={withService()} />);
    const { event } = clipboardEvent("paste", encodeNode(newNode("cache", "cache")));
    fireEvent(screen.getByLabelText("Instances"), event);
    expect(ids()).toEqual(["client", "service"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the settings of the component that was copied", () => {
    render(<Harness initial={withService()} />);
    const tuned = { ...newNode("service", "api"), service: { instances: 7, meanServiceMs: 3.5, queueCapacity: 250 } };
    fireEvent(document, clipboardEvent("paste", encodeNode(tuned)).event);
    expect(ids()).toEqual(["client", "service", "api"]);
  });
});

// The listeners are on the document, which outlives the canvas. Left behind,
// they would go on pasting into a design nothing is rendering — and React
// would warn about state set on an unmounted component, which is the polite
// version of a leak.
describe("useClipboard when the canvas goes", () => {
  it("stops listening once it is unmounted", () => {
    const { unmount } = render(<Harness initial={withService()} />);
    unmount();
    const { event } = clipboardEvent("paste", encodeNode(newNode("cache", "cache")));
    fireEvent(document, event);
    expect(event.defaultPrevented).toBe(false);
  });
});
