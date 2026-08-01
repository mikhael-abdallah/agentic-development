import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Schema } from "@/features/inspector/Schema";
import type { Query, Table } from "@/lib/topology";

const OPERATIONS = ["resolve", "shorten"];

const LINKS: Table[] = [
  {
    name: "links",
    rows: 50_000_000,
    columns: [
      { name: "code", indexed: true },
      { name: "target", indexed: false },
    ],
  },
];

const RESOLVE: Query[] = [{ operation: "resolve", table: "links", by: "code", rowsMatched: 1 }];

function editor(tables = LINKS, queries = RESOLVE, operations = OPERATIONS) {
  const onChange = vi.fn<(next: { tables: Table[]; queries: Query[] }) => void>();
  const result = render(
    <Schema tables={tables} queries={queries} operations={operations} onChange={onChange} />,
  );
  return { ...result, onChange };
}

/** What onChange was last handed. Throws rather than returning undefined: a
 *  test that read `undefined` and carried on would assert about nothing. */
function lastCall(onChange: ReturnType<typeof vi.fn>): { tables: Table[]; queries: Query[] } {
  const call: unknown = onChange.mock.lastCall?.[0];
  if (typeof call !== "object" || call === null) {
    throw new Error("onChange was not called with a schema");
  }
  return call as { tables: Table[]; queries: Query[] };
}

describe("Schema", () => {
  // Queried by label rather than by value: a query names the table it reads
  // and the column it uses, so "links" and "code" each appear in two boxes and
  // a search by value cannot say which one it found.
  it("shows what the database holds", () => {
    editor();
    expect(screen.getByLabelText("Name of table 1")).toHaveProperty("value", "links");
    expect(screen.getByLabelText("Rows in links")).toHaveProperty("value", "50000000");
    expect(screen.getByLabelText("Name of column 1 of links")).toHaveProperty("value", "code");
    expect(screen.getByLabelText("Name of column 2 of links")).toHaveProperty("value", "target");
  });

  // The one decision the whole schema exists to make writable.
  it("indexes a column and unindexes one", () => {
    const { container, onChange } = editor();
    const boxes = container.querySelectorAll<HTMLInputElement>(".column__indexed input");
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    fireEvent.click(boxes[0] ?? container);
    expect(lastCall(onChange).tables[0]?.columns[0]?.indexed).toBe(false);
  });

  it("changes how many rows a table holds", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Rows in links"), { target: { value: "120" } });
    expect(lastCall(onChange).tables[0]?.rows).toBe(120);
  });

  it("adds a table, already carrying a column to name", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add a table" }));
    const added = lastCall(onChange).tables[1];
    expect(added?.rows).toBeGreaterThan(0);
    // The engine refuses a table with no columns, so one arriving without any
    // would make the design unrunnable the moment it appeared.
    expect(added?.columns).toHaveLength(1);
  });

  it("adds and removes a column", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add a column to links" }));
    expect(lastCall(onChange).tables[0]?.columns).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove column target of links" }));
    expect(lastCall(onChange).tables[0]?.columns.map((c) => c.name)).toEqual(["code"]);
  });

  it("removes a table", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Remove links" }));
    expect(lastCall(onChange).tables).toHaveLength(0);
  });

  it("shows what each operation asks for", () => {
    editor();
    expect(screen.getByLabelText("Table resolve reads")).toHaveProperty("value", "links");
    expect(screen.getByLabelText("Column resolve looks up by")).toHaveProperty("value", "code");
    expect(screen.getByLabelText("Rows resolve matches")).toHaveProperty("value", "1");
  });

  // Every name in a schema is editable, and every one of them is a name
  // something else refers to: a query names a table and a column, so renaming
  // either is how a schema stops validating. Each edit is checked rather than
  // trusted to be the same code as its neighbour.
  it("renames a table, a column and what a query asks for", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Name of table 1"), { target: { value: "urls" } });
    expect(lastCall(onChange).tables[0]?.name).toBe("urls");

    fireEvent.change(screen.getByLabelText("Name of column 1 of links"), {
      target: { value: "slug" },
    });
    expect(lastCall(onChange).tables[0]?.columns[0]?.name).toBe("slug");

    fireEvent.change(screen.getByLabelText("Operation query 1 serves"), {
      target: { value: "redirect" },
    });
    expect(lastCall(onChange).queries[0]?.operation).toBe("redirect");

    fireEvent.change(screen.getByLabelText("Table resolve reads"), { target: { value: "urls" } });
    expect(lastCall(onChange).queries[0]?.table).toBe("urls");

    fireEvent.change(screen.getByLabelText("Rows resolve matches"), { target: { value: "12" } });
    expect(lastCall(onChange).queries[0]?.rowsMatched).toBe(12);
  });

  it("changes which column a query looks up by", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Column resolve looks up by"), {
      target: { value: "target" },
    });
    expect(lastCall(onChange).queries[0]?.by).toBe("target");
  });

  it("adds and removes a query", () => {
    const { onChange } = editor();
    fireEvent.click(screen.getByRole("button", { name: "Add a query" }));
    expect(lastCall(onChange).queries).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove resolve" }));
    expect(lastCall(onChange).queries).toHaveLength(0);
  });

  // The engine accepts a query for traffic this run does not send — a schema
  // describes a database more fully than any one load exercises it. But the
  // other reason a name does not match is a typo, and a typo is silent: the
  // cost falls back to the mean and the run answers about a query nobody made.
  it("says when a query asks for traffic nothing sends", () => {
    editor(LINKS, [{ operation: "purge", table: "links", by: "code", rowsMatched: 1 }]);
    expect(screen.getByText(/Nothing in the current load asks for purge/)).toBeDefined();
  });

  it("says nothing about a query the load does reach", () => {
    editor();
    expect(screen.queryByText(/Nothing in the current load asks for/)).toBeNull();
  });

  // A query's column field offers the columns of the table it names, rather
  // than every column in the schema — which on a design with several tables is
  // the difference between a list that helps and one that misleads.
  it("offers the columns of the table a query names", () => {
    const visits: Table = {
      name: "visits",
      rows: 10,
      columns: [{ name: "at", indexed: false }],
    };
    const { container } = editor([...LINKS, visits], RESOLVE);
    const lists = [...container.querySelectorAll("datalist")];
    const columns = lists.find((list) => list.id.includes("-cols-"));
    expect([...(columns?.querySelectorAll("option") ?? [])].map((o) => o.value)).toEqual([
      "code",
      "target",
    ]);
  });

  it("labels a table and a query that have not been named yet", () => {
    editor(
      [{ name: "", rows: 1, columns: [{ name: "", indexed: false }] }],
      [{ operation: "", table: "", by: "", rowsMatched: 1 }],
    );
    expect(screen.getByLabelText("Name of table 1")).toBeDefined();
    expect(screen.getByLabelText("Rows in table 1")).toBeDefined();
    expect(screen.getByLabelText("Name of column 1 of table 1")).toBeDefined();
    expect(screen.getByLabelText("Operation query 1 serves")).toBeDefined();
    expect(screen.getByLabelText("Rows query 1 matches")).toBeDefined();
  });

  // A half-typed number parses as NaN, and passing that on would put a row
  // count into the design that nothing on screen can describe.
  it("ignores a row count that is not a number", () => {
    const { onChange } = editor();
    fireEvent.change(screen.getByLabelText("Rows in links"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Rows resolve matches"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Two tables are both blank the moment a second one is added, and a list
  // keyed by their names would collide — a console warning that reads as a bug
  // to anyone watching, on the most ordinary gesture the panel has.
  it("holds two unnamed tables without complaining", () => {
    const warned: unknown[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...args) => {
      warned.push(args);
    });
    const blank = { name: "", rows: 10, columns: [{ name: "", indexed: false }] };
    editor([blank, { ...blank }], []);
    expect(warned).toEqual([]);
    error.mockRestore();
  });
});
