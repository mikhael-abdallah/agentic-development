import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Inspector } from "@/features/inspector/Inspector";
import { NODE_KINDS, type DesignNode, newNode } from "@/lib/topology";

const NO_WIRING = { incoming: [], outgoing: [] };

/** The operation names the load offers. Most cases here are not about a
 *  service's API, so they say what the shortener says and move on. */
const OPERATIONS = ["resolve", "shorten"];

function box(label: RegExp | string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(label);
}

describe("Inspector", () => {
  it("says what to do when nothing is selected", () => {
    render(<Inspector node={undefined} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Select a component/)).toBeDefined();
  });

  // Every kind has to be editable. One that renders an empty panel looks like
  // a broken inspector rather than a missing editor, and nothing else would
  // notice: the design still simulates, on parameters nobody could reach.
  it("has something to show for every kind in the contract", () => {
    for (const kind of NODE_KINDS) {
      const { unmount } = render(<Inspector node={newNode(kind, kind)} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
      const panel = screen.getByRole("complementary", { name: "Component settings" });
      // Something beyond the heading and the scope line: an editor, not a
      // label. The blurb alone would satisfy a looser check.
      expect(panel.querySelectorAll(".field").length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("edits a number and leaves the rest of the component alone", () => {
    const onChange = vi.fn();
    const node = newNode("service", "api");
    render(<Inspector node={node} operations={OPERATIONS} wiring={NO_WIRING} onChange={onChange} onRemove={vi.fn()} />);
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
    render(<Inspector node={newNode("cache", "c")} operations={OPERATIONS} wiring={NO_WIRING} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.change(box(/Hit ratio/), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes a balancer's strategy", () => {
    const onChange = vi.fn();
    const node = newNode("loadBalancer", "lb");
    render(<Inspector node={node} operations={OPERATIONS} wiring={NO_WIRING} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Strategy/), { target: { value: "roundRobin" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...node,
      loadBalancer: { ...node.loadBalancer, algorithm: "roundRobin" },
    });
  });

  it("offers every strategy the engine knows", () => {
    render(<Inspector node={newNode("loadBalancer", "lb")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("renames a component, and says the name changes nothing else", () => {
    const onChange = vi.fn();
    const node = newNode("database", "db");
    render(<Inspector node={node} operations={OPERATIONS} wiring={NO_WIRING} onChange={onChange} onRemove={vi.fn()} />);
    fireEvent.change(box("Name"), { target: { value: "Key store" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...node, label: "Key store" });
    expect(screen.getByText(/no effect on the simulation/)).toBeDefined();
  });

  it("falls back to the kind's name in the placeholder rather than inventing one", () => {
    render(<Inspector node={newNode("database", "db")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(box("Name").placeholder).toBe("Database");
  });

  it("tells the client's story rather than showing it an empty form", () => {
    render(<Inspector node={newNode("client", "client")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/offers the load/)).toBeDefined();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  // Parameters travel in a union keyed by kind, and a node arriving over the
  // wire could be missing its half. Rendering nothing beats rendering a form
  // bound to undefined.
  it("shows no form for a component whose parameters are absent", () => {
    const bare: DesignNode = { id: "x", kind: "service" };
    render(<Inspector node={bare} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("carries the engine's own bounds onto the inputs", () => {
    render(<Inspector node={newNode("cache", "c")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    const ratio = box(/Hit ratio/);
    expect(ratio.min).toBe("0");
    expect(ratio.max).toBe("1");
  });
});

// Removing a component worked before this — React Flow deletes the selection
// on Backspace — but nothing on screen said so, and the key most people reach
// for did nothing at all. A capability nobody can find is not one.
describe("Inspector removing a component", () => {
  it("offers to remove the selected component", () => {
    const onRemove = vi.fn();
    render(
      <Inspector node={newNode("cache", "cache")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove this component/ }));
    expect(onRemove).toHaveBeenCalledWith("cache");
  });

  // Including the client, which used to be the one exception. A design cannot
  // be run without one, but that is a fact about running it — said by
  // `whyNotRun` next to the button it disables — and not a reason to withhold
  // the control here.
  it("offers to remove the client too", () => {
    const onRemove = vi.fn();
    render(
      <Inspector
        node={newNode("client", "client")}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove this component/ }));
    expect(onRemove).toHaveBeenCalledWith("client");
  });
});

// Three panels stack in one column drawing identical rows of numbers, so
// nothing but the heading says whether a number belongs to one component or to
// the whole run. Without it, a queue capacity and an arrival rate read as two
// settings of the same thing.
describe("Inspector saying whose settings these are", () => {
  it("names the selected component rather than the panel", () => {
    render(
      <Inspector
        node={{ ...newNode("cache", "cache"), label: "Key cache" }}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Key cache" })).toBeDefined();
    expect(screen.getByText("Selected component")).toBeDefined();
  });

  it("falls back to the kind when the component has no name of its own", () => {
    render(
      <Inspector node={newNode("database", "database")} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Database" })).toBeDefined();
  });

  it("says so plainly when nothing is selected", () => {
    render(<Inspector node={undefined} operations={OPERATIONS} wiring={NO_WIRING} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Nothing selected" })).toBeDefined();
  });
});

// The one parameter whose cost the simulator does not measure, so the panel
// has to say what it is rather than leaving the numbers to recommend.
describe("Inspector choosing how writes go past a cache", () => {
  function cacheInspector(onChange = vi.fn()) {
    render(
      <Inspector
        node={newNode("cache", "cache")}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    return onChange;
  }

  it("offers every policy the engine accepts", () => {
    cacheInspector();
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["write through", "write around", "write back"]);
  });

  it("starts on the policy a new cache has", () => {
    cacheInspector();
    expect(screen.getByLabelText<HTMLSelectElement>("Writes").value).toBe("writeThrough");
  });

  it("changes the policy without disturbing the rest of the cache", () => {
    const onChange = cacheInspector();
    fireEvent.change(screen.getByLabelText("Writes"), { target: { value: "writeBack" } });
    const sent = onChange.mock.calls[0]?.[0] as DesignNode;
    expect(sent.cache?.writePolicy).toBe("writeBack");
    expect(sent.cache?.hitRatio).toBe(newNode("cache", "cache").cache?.hitRatio);
  });

  // Write-back makes a saturated database look idle. Showing that without
  // showing what it costs would be a recommendation on complete evidence and
  // the wrong recommendation.
  it("says what each policy costs, including the part it cannot measure", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Inspector
        node={newNode("cache", "cache")}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    const node = newNode("cache", "cache");
    for (const [policy, expected] of [
      ["writeAround", /Staleness is not simulated/],
      ["writeBack", /durability/],
    ] as const) {
      rerender(
        <Inspector
          node={{ ...node, cache: { ...node.cache, writePolicy: policy } as never }}
          operations={OPERATIONS}
          wiring={NO_WIRING}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByText(expected)).toBeDefined();
    }
  });

  // A service's API, through the panel rather than through the editor alone.
  it("adds an endpoint to a service", () => {
    const onChange = vi.fn();
    const node = newNode("service", "api");
    render(
      <Inspector
        node={node}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add an endpoint" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...node,
      service: { ...node.service, endpoints: [{ name: "", operation: "", meanServiceMs: 1 }] },
    });
  });

  // Emptying the list takes the key with it rather than leaving `endpoints: []`.
  // The engine and the clipboard both read absent and empty the same way, so an
  // empty list left behind would make deleting the last endpoint and then
  // copying the component produce something that is not equal to what was
  // copied while behaving identically. Equal is what a round trip can check.
  it("takes the key with the last endpoint rather than leaving an empty list", () => {
    const onChange = vi.fn();
    const described: DesignNode = {
      ...newNode("service", "api"),
      service: {
        instances: 1,
        meanServiceMs: 2,
        queueCapacity: 500,
        endpoints: [{ name: "GET /{code}", operation: "resolve", meanServiceMs: 7 }],
      },
    };
    render(
      <Inspector
        node={described}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove GET /{code}" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...described,
      service: { instances: 1, meanServiceMs: 2, queueCapacity: 500 },
    });
    const [changed] = onChange.mock.calls[0] as [DesignNode];
    expect(changed.service).not.toHaveProperty("endpoints");
  });

  // A store shows no scan rate until it has a schema. Converting rows into
  // milliseconds is an arithmetic that only exists once there are rows, and a
  // box asking for a number nothing would use invites a wrong answer.
  it("asks for a scan rate only once the database has a schema", () => {
    const plain = newNode("database", "db");
    const { unmount } = render(
      <Inspector
        node={plain}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Scan rate/)).toBeNull();
    unmount();

    const described: DesignNode = {
      ...plain,
      database: {
        replicas: 0,
        meanReadMs: 1,
        meanWriteMs: 1,
        poolSize: 1,
        tables: [{ name: "links", rows: 10, columns: [{ name: "code", indexed: true }] }],
        queries: [],
        scanPerMillionRowsMs: 20,
      },
    };
    render(
      <Inspector
        node={described}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Scan rate/)).toBeDefined();
  });

  // Emptying the schema takes all three keys with it, the same rule an emptied
  // API follows: absent and empty read the same to the engine and to the
  // clipboard, so leaving them behind would make a copy that is not equal to
  // what was copied while behaving identically.
  it("takes the schema keys with the last table rather than leaving empty lists", () => {
    const onChange = vi.fn();
    const described: DesignNode = {
      ...newNode("database", "db"),
      database: {
        replicas: 0,
        meanReadMs: 1,
        meanWriteMs: 1,
        poolSize: 1,
        tables: [{ name: "links", rows: 10, columns: [{ name: "code", indexed: true }] }],
        queries: [],
        scanPerMillionRowsMs: 20,
      },
    };
    render(
      <Inspector
        node={described}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove links" }));
    const [changed] = onChange.mock.calls[0] as [DesignNode];
    expect(changed.database).toEqual({
      replicas: 0,
      meanReadMs: 1,
      meanWriteMs: 1,
      poolSize: 1,
    });
    for (const key of ["tables", "queries", "scanPerMillionRowsMs"]) {
      expect(changed.database).not.toHaveProperty(key);
    }
  });

  // Editing a schema that is already there, and the scan rate beside it.
  it("edits a schema and the rate its scans are charged at", () => {
    const onChange = vi.fn();
    const described: DesignNode = {
      ...newNode("database", "db"),
      database: {
        replicas: 0,
        meanReadMs: 1,
        meanWriteMs: 1,
        poolSize: 1,
        tables: [{ name: "links", rows: 10, columns: [{ name: "code", indexed: true }] }],
        queries: [],
        scanPerMillionRowsMs: 20,
      },
    };
    const { rerender } = render(
      <Inspector
        node={described}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Scan rate/), { target: { value: "45" } });
    const [rated] = onChange.mock.calls[0] as [DesignNode];
    expect(rated.database?.scanPerMillionRowsMs).toBe(45);

    onChange.mockClear();
    rerender(
      <Inspector
        node={described}
        operations={OPERATIONS}
        wiring={NO_WIRING}
        onChange={onChange}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a query" }));
    const [queried] = onChange.mock.calls[0] as [DesignNode];
    expect(queried.database?.queries).toHaveLength(1);
    // Still carried, because the schema did not go away.
    expect(queried.database?.scanPerMillionRowsMs).toBe(20);
  });
});
