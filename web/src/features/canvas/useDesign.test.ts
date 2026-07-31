import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDesign } from "@/features/canvas/useDesign";
import { type Design, addNode, connect, emptyDesign } from "@/lib/design";

const SOMEWHERE = { x: 10, y: 20 };

function edgeList(design: Design): string[] {
  return design.topology.edges.map((edge) => `${edge.from}->${edge.to}`);
}

describe("useDesign", () => {
  it("starts on an empty design when it is given none", () => {
    const { result } = renderHook(() => useDesign());
    expect(result.current.design.topology.nodes.map((node) => node.kind)).toEqual(["client"]);
  });

  it("starts on the design it is given", () => {
    const initial = addNode(emptyDesign(), "cache", SOMEWHERE);
    const { result } = renderHook(() => useDesign(initial));
    expect(result.current.design.topology.nodes).toHaveLength(2);
  });

  it("adds, moves, links, unlinks and removes", () => {
    const { result } = renderHook(() => useDesign());

    act(() => {
      result.current.add("service", SOMEWHERE);
    });
    expect(result.current.design.positions.get("service")).toEqual(SOMEWHERE);

    act(() => {
      result.current.move("service", { x: 1, y: 2 });
    });
    expect(result.current.design.positions.get("service")).toEqual({ x: 1, y: 2 });

    act(() => {
      result.current.link("client", "service");
    });
    expect(edgeList(result.current.design)).toEqual(["client->service"]);

    act(() => {
      result.current.unlink("client", "service");
    });
    expect(edgeList(result.current.design)).toEqual([]);

    act(() => {
      result.current.drop("service");
    });
    expect(result.current.design.topology.nodes).toHaveLength(1);
  });

  it("selects and clears the selection", () => {
    const { result } = renderHook(() => useDesign());
    act(() => {
      result.current.select("client");
    });
    expect(result.current.design.selected).toBe("client");
    act(() => {
      result.current.select(null);
    });
    expect(result.current.design.selected).toBeNull();
  });

  it("replaces an edited component", () => {
    const { result } = renderHook(() => useDesign(addNode(emptyDesign(), "cache", SOMEWHERE)));
    act(() => {
      result.current.replace({
        id: "cache",
        kind: "cache",
        cache: { hitRatio: 0.1, hitLatencyMs: 1 },
      });
    });
    const cache = result.current.design.topology.nodes.find((node) => node.id === "cache");
    expect(cache?.cache?.hitRatio).toBeCloseTo(0.1);
  });

  it("loads a design over the one being edited", () => {
    const { result } = renderHook(() => useDesign());
    const loaded = connect(addNode(emptyDesign(), "database", SOMEWHERE), "client", "database");
    act(() => {
      result.current.load(loaded);
    });
    expect(edgeList(result.current.design)).toEqual(["client->database"]);
  });

  // Every rule about what a design may be lives in lib/design, and the hook is
  // the useState around it. A refused edge has to stay refused here too, or
  // there would be two answers to what a valid design is.
  it("refuses through the same rules the pure functions do", () => {
    const { result } = renderHook(() => useDesign());
    act(() => {
      result.current.add("service", SOMEWHERE);
    });
    act(() => {
      result.current.link("service", "client");
    });
    expect(edgeList(result.current.design)).toEqual([]);
  });
});

// The palette's click path had no position to give, so every component it
// added landed on the same fixed point and stacked into one visible box.
describe("useDesign adding without a position", () => {
  it("finds room rather than stacking components on one spot", () => {
    const { result } = renderHook(() => useDesign());
    act(() => {
      result.current.add("service");
    });
    act(() => {
      result.current.add("cache");
    });
    act(() => {
      result.current.add("database");
    });
    const placed = [...result.current.design.positions.values()].map((at) => [at.x, at.y].join(","));
    expect(placed).toHaveLength(4);
    expect(new Set(placed).size).toBe(4);
  });

  it("still puts a component exactly where it was dropped", () => {
    const { result } = renderHook(() => useDesign());
    act(() => {
      result.current.add("cache", SOMEWHERE);
    });
    expect(result.current.design.positions.get("cache")).toEqual(SOMEWHERE);
  });
});
