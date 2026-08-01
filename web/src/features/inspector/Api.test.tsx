import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Api } from "@/features/inspector/Api";
import type { Endpoint } from "@/lib/topology";

const OPERATIONS = ["resolve", "shorten"];

const SHORTENER: Endpoint[] = [
  { name: "GET /{code}", operation: "resolve", meanServiceMs: 7 },
  { name: "POST /shorten", operation: "shorten", meanServiceMs: 25 },
];

function editor(endpoints: Endpoint[] = SHORTENER, operations = OPERATIONS) {
  const onChange = vi.fn<(next: Endpoint[]) => void>();
  const result = render(<Api endpoints={endpoints} operations={operations} onChange={onChange} />);
  return { ...result, onChange };
}

/** What onChange was last handed. Throws rather than returning undefined: a
 *  test that read `undefined` and carried on would assert about nothing. */
function lastCall(onChange: ReturnType<typeof vi.fn>): Endpoint[] {
  const call: unknown = onChange.mock.lastCall?.[0];
  if (!Array.isArray(call)) {
    throw new Error("onChange was not called with a list of endpoints");
  }
  return call as Endpoint[];
}

describe("Api", () => {
  it("shows the calls a service answers", () => {
    editor();
    expect(screen.getByDisplayValue("GET /{code}")).toBeDefined();
    expect(screen.getByDisplayValue("POST /shorten")).toBeDefined();
    expect(screen.getByLabelText("Time GET /{code} takes")).toHaveProperty("value", "7");
  });

  // An empty list is a complete answer, not an unfinished form: a service that
  // describes no API costs its mean for everything, which is what every
  // service did before endpoints existed.
  it("shows an empty API without complaint", () => {
    const { container } = editor([]);
    expect(container.querySelectorAll(".endpoint")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add an endpoint" })).toBeDefined();
  });

  it("renames an endpoint", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByDisplayValue("GET /{code}"), {
      target: { value: "GET /r/{code}" },
    });
    expect(lastCall(onChange)[0]?.name).toBe("GET /r/{code}");
  });

  it("changes which operation an endpoint serves", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Operation GET /{code} serves"), {
      target: { value: "preview" },
    });
    expect(lastCall(onChange)[0]?.operation).toBe("preview");
  });

  it("changes what a call costs", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Time POST /shorten takes"), {
      target: { value: "40" },
    });
    expect(lastCall(onChange)[1]?.meanServiceMs).toBe(40);
  });

  it("adds an endpoint", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add an endpoint" }));
    expect(lastCall(onChange)).toHaveLength(3);
    // Above zero, because the engine refuses an endpoint that costs nothing —
    // a row arriving at zero would make the design unrunnable the moment it
    // appeared.
    expect(lastCall(onChange)[2]?.meanServiceMs).toBeGreaterThan(0);
  });

  it("removes an endpoint", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Remove POST /shorten" }));
    expect(lastCall(onChange).map((endpoint) => endpoint.name)).toEqual(["GET /{code}"]);
  });

  // The engine accepts an endpoint for traffic this run does not send: an API
  // describes more than any one load exercises. But the other reason a name
  // does not match is a typo, and a typo here is silent — the request falls
  // back to the service's mean and the run answers about a number nobody
  // chose. So it is said rather than refused.
  it("says when an endpoint asks for traffic nothing sends", () => {
    editor([{ name: "DELETE /{code}", operation: "purge", meanServiceMs: 4 }]);
    expect(screen.getByText(/Nothing in the current load asks for purge/)).toBeDefined();
  });

  it("says nothing about an endpoint the load does reach", () => {
    editor();
    expect(screen.queryByText(/Nothing in the current load asks for/)).toBeNull();
  });

  // A row is added empty and named afterwards, so the warning would fire on
  // every new row before anything had been typed into it.
  it("says nothing about a row with no operation yet", () => {
    editor([{ name: "", operation: "", meanServiceMs: 1 }]);
    expect(screen.queryByText(/Nothing in the current load asks for/)).toBeNull();
  });

  // Every label built from the name would be the same empty string on every
  // unnamed row, and a screen reader would announce several controls that
  // could not be told apart.
  it("labels a row that has not been named yet", () => {
    editor([{ name: "", operation: "", meanServiceMs: 1 }]);
    expect(screen.getByLabelText("Name of endpoint 1")).toBeDefined();
    expect(screen.getByLabelText("Operation endpoint 1 serves")).toBeDefined();
    expect(screen.getByLabelText("Time endpoint 1 takes")).toBeDefined();
    expect(screen.getByLabelText("Remove endpoint 1")).toBeDefined();
  });

  // A half-typed number parses as NaN, and passing that on would put a cost
  // into the design that nothing on screen can describe.
  it("ignores a cost that is not a number", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Time GET /{code} takes"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Offered rather than enforced, because an endpoint may legitimately name
  // traffic the current load does not send.
  it("offers the operations the load does have", () => {
    const { container } = editor();
    const offered = [...container.querySelectorAll("datalist option")].map(
      (option) => option.getAttribute("value"),
    );
    expect(offered).toEqual(OPERATIONS);
  });
});
