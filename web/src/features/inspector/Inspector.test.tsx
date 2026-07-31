import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Inspector } from "@/features/inspector/Inspector";
import { NODE_KINDS, type DesignNode, newNode } from "@/lib/topology";

function box(label: RegExp | string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(label);
}

describe("Inspector", () => {
  it("says what to do when nothing is selected", () => {
    render(<Inspector node={undefined} onChange={vi.fn()} />);
    expect(screen.getByText(/Select a component/)).toBeDefined();
  });

  // Every kind has to be editable. One that renders an empty panel looks like
  // a broken inspector rather than a missing editor, and nothing else would
  // notice: the design still simulates, on parameters nobody could reach.
  it("has something to show for every kind in the contract", () => {
    for (const kind of NODE_KINDS) {
      const { unmount } = render(<Inspector node={newNode(kind, kind)} onChange={vi.fn()} />);
      expect(screen.getByRole("complementary", { name: "Parameters" }).textContent).not.toBe(
        "Parameters",
      );
      unmount();
    }
  });

  it("edits a number and leaves the rest of the component alone", () => {
    const onChange = vi.fn();
    const node = newNode("service", "api");
    render(<Inspector node={node} onChange={onChange} />);
    fireEvent.change(box(/Instances/), { target: { value: "9" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...node,
      service: { ...node.service, instances: 9 },
    });
  });

  // A half-typed or emptied box parses as NaN. Sending that on would put the
  // design into a state the engine refuses and the canvas cannot describe.
  it("ignores a box that does not currently hold a number", () => {
    const onChange = vi.fn();
    render(<Inspector node={newNode("cache", "c")} onChange={onChange} />);
    fireEvent.change(box(/Hit ratio/), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes a balancer's strategy", () => {
    const onChange = vi.fn();
    const node = newNode("loadBalancer", "lb");
    render(<Inspector node={node} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Strategy/), { target: { value: "roundRobin" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...node,
      loadBalancer: { ...node.loadBalancer, algorithm: "roundRobin" },
    });
  });

  it("offers every strategy the engine knows", () => {
    render(<Inspector node={newNode("loadBalancer", "lb")} onChange={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("renames a component, and says the name changes nothing else", () => {
    const onChange = vi.fn();
    const node = newNode("database", "db");
    render(<Inspector node={node} onChange={onChange} />);
    fireEvent.change(box("Name"), { target: { value: "Key store" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...node, label: "Key store" });
    expect(screen.getByText(/no effect on the simulation/)).toBeDefined();
  });

  it("falls back to the kind's name in the placeholder rather than inventing one", () => {
    render(<Inspector node={newNode("database", "db")} onChange={vi.fn()} />);
    expect(box("Name").placeholder).toBe("Database");
  });

  it("tells the client's story rather than showing it an empty form", () => {
    render(<Inspector node={newNode("client", "client")} onChange={vi.fn()} />);
    expect(screen.getByText(/offers the load/)).toBeDefined();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  // Parameters travel in a union keyed by kind, and a node arriving over the
  // wire could be missing its half. Rendering nothing beats rendering a form
  // bound to undefined.
  it("shows no form for a component whose parameters are absent", () => {
    const bare: DesignNode = { id: "x", kind: "service" };
    render(<Inspector node={bare} onChange={vi.fn()} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("carries the engine's own bounds onto the inputs", () => {
    render(<Inspector node={newNode("cache", "c")} onChange={vi.fn()} />);
    const ratio = box(/Hit ratio/);
    expect(ratio.min).toBe("0");
    expect(ratio.max).toBe("1");
  });
});
