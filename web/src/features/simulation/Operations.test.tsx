import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Operations } from "@/features/simulation/Operations";
import type { Operation } from "@/lib/topology";

const SHORTENER: Operation[] = [
  { name: "resolve", kind: "read", share: 0.95 },
  { name: "shorten", kind: "write", share: 0.05 },
];

function editor(operations: Operation[] = SHORTENER) {
  const onChange = vi.fn<(next: Operation[]) => void>();
  const result = render(<Operations operations={operations} onChange={onChange} />);
  return { ...result, onChange };
}

/** What onChange was last handed. Throws rather than returning undefined: a
 *  test that read `undefined` and carried on would assert about nothing. */
function lastCall(onChange: ReturnType<typeof vi.fn>): Operation[] {
  const call: unknown = onChange.mock.lastCall?.[0];
  if (!Array.isArray(call)) {
    throw new Error("onChange was not called with a list of operations");
  }
  return call as Operation[];
}

describe("Operations", () => {
  it("shows what the design is asked to do", () => {
    editor();
    expect(screen.getByDisplayValue("resolve")).toBeDefined();
    expect(screen.getByDisplayValue("shorten")).toBeDefined();
  });

  // Shares are a fraction in the contract and a percentage on screen, because
  // a percentage is how anyone says it out loud. The conversion happens at
  // this boundary and nowhere else, so both directions are worth checking.
  it("shows a share as a percentage", () => {
    editor();
    expect(screen.getByLabelText("Share of traffic for resolve")).toHaveProperty("value", "95");
  });

  it("stores a typed percentage as a fraction", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Share of traffic for shorten"), {
      target: { value: "20" },
    });
    expect(lastCall(onChange)[1]?.share).toBeCloseTo(0.2, 10);
  });

  it("renames an operation", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByDisplayValue("resolve"), { target: { value: "redirect" } });
    expect(lastCall(onChange)[0]?.name).toBe("redirect");
  });

  it("changes what an operation does", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("What resolve does"), { target: { value: "write" } });
    expect(lastCall(onChange)[0]?.kind).toBe("write");
  });

  it("adds an operation", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add an operation" }));
    expect(lastCall(onChange)).toHaveLength(3);
  });

  // An operation with no share is one the engine refuses outright, so a row
  // that arrived at zero would be a row that made the design unrunnable the
  // moment it appeared.
  it("gives a new operation a share to start from", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add an operation" }));
    expect(lastCall(onChange)[2]?.share).toBeGreaterThan(0);
  });

  it("removes an operation", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Remove shorten" }));
    expect(lastCall(onChange).map((operation) => operation.name)).toEqual(["resolve"]);
  });

  // Always, rather than only when it is wrong. A number that appears at the
  // moment of a mistake reads as an error message; one that is always there is
  // something to aim at.
  it("says how much of the traffic is accounted for", () => {
    editor();
    expect(screen.getByText("100% of the traffic")).toBeDefined();
  });

  it("says so when the shares do not add up", () => {
    editor([{ name: "resolve", kind: "read", share: 0.6 }]);
    expect(screen.getByText("60% of the traffic")).toBeDefined();
  });

  // A row with no name yet still has to be reachable: labels built from the
  // name would all be the empty string, and every control on the row would
  // have the same accessible name as every other row's.
  it("labels a row that has not been named yet", () => {
    editor([{ name: "", kind: "read", share: 1 }]);
    expect(screen.getByLabelText("Name of operation 1")).toBeDefined();
    expect(screen.getByLabelText("Share of traffic for operation 1")).toBeDefined();
    expect(screen.getByLabelText("Remove operation 1")).toBeDefined();
  });

  // A half-typed number parses as NaN. Passing that on would put a share into
  // the workload that nothing on screen can describe and the engine refuses.
  it("ignores a share that is not a number", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Share of traffic for resolve"), {
      target: { value: "" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
