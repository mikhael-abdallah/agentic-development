"use client";

import { useId } from "react";

import type { Column, Query, Table } from "@/lib/topology";

interface SchemaProps {
  readonly tables: Table[];
  readonly queries: Query[];
  /** The operations the current load offers, so a query can say when it names
   *  traffic nothing sends. */
  readonly operations: string[];
  readonly onChange: (schema: { tables: Table[]; queries: Query[] }) => void;
}

/** What to call a table in a label: its name once it has one, its position
 *  until then. Rows are added empty and named afterwards, and every unnamed one
 *  sharing the empty string would give every control the same accessible
 *  name. */
function callingTable(table: Table, index: number): string {
  return table.name === "" ? `table ${String(index + 1)}` : table.name;
}

function callingQuery(query: Query, index: number): string {
  return query.operation === "" ? `query ${String(index + 1)}` : query.operation;
}

interface ColumnsProps {
  readonly table: Table;
  readonly index: number;
  readonly onTable: (table: Table) => void;
}

/**
 * The columns of one table.
 *
 * Indexed is a checkbox and nothing else is offered, because indexed or not is
 * the whole of what the model can act on. A type or a width changes what a row
 * costs to store and nothing about what a query costs to answer, and a field
 * that moved no number would be decoration on a page whose whole argument is
 * that every number shown is one the simulation used.
 */
function Columns({ table, index, onTable }: ColumnsProps) {
  const named = callingTable(table, index);
  const replace = (at: number, column: Column) => {
    onTable({ ...table, columns: table.columns.map((c, i) => (i === at ? column : c)) });
  };
  return (
    <ul className="columns">
      {table.columns.map((column, at) => (
        // Keyed by position: the name is what is being edited here too.
        <li className="column" key={at}>
          <input
            className="column__name"
            type="text"
            aria-label={`Name of column ${String(at + 1)} of ${named}`}
            placeholder="code"
            value={column.name}
            onChange={(event) => {
              replace(at, { ...column, name: event.target.value });
            }}
          />
          <label className="column__indexed">
            <input
              type="checkbox"
              checked={column.indexed}
              onChange={(event) => {
                replace(at, { ...column, indexed: event.target.checked });
              }}
            />
            indexed
          </label>
          <button
            type="button"
            className="column__remove"
            aria-label={`Remove column ${column.name === "" ? String(at + 1) : column.name} of ${named}`}
            onClick={() => {
              onTable({ ...table, columns: table.columns.filter((_, i) => i !== at) });
            }}
          >
            ×
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          className="columns__add"
          onClick={() => {
            onTable({ ...table, columns: [...table.columns, { name: "", indexed: false }] });
          }}
        >
          Add a column to {named}
        </button>
      </li>
    </ul>
  );
}

interface TablesProps {
  readonly tables: Table[];
  readonly onTables: (tables: Table[]) => void;
}

/** The tables, each with its rows and its columns. Its own component because
 *  `Schema` holding both lists inline outgrew the length a component is
 *  allowed here — and the two lists are genuinely separate things that happen
 *  to need checking against each other. */
function Tables({ tables, onTables }: TablesProps) {
  const replace = (index: number, table: Table) => {
    onTables(tables.map((t, i) => (i === index ? table : t)));
  };
  return (
    <>
      <ul className="tables">
        {tables.map((table, index) => (
          // Keyed by position: the name is what is being edited.
          <li className="table" key={index}>
            <div className="table__head">
              <input
                className="table__name"
                type="text"
                aria-label={`Name of table ${String(index + 1)}`}
                placeholder="links"
                value={table.name}
                onChange={(event) => {
                  replace(index, { ...table, name: event.target.value });
                }}
              />
              <input
                className="table__rows"
                type="number"
                aria-label={`Rows in ${callingTable(table, index)}`}
                min={1}
                step={1000}
                value={table.rows}
                onChange={(event) => {
                  const rows = event.target.valueAsNumber;
                  if (Number.isFinite(rows)) {
                    replace(index, { ...table, rows });
                  }
                }}
              />
              <span className="table__unit">rows</span>
              <button
                type="button"
                className="table__remove"
                aria-label={`Remove ${callingTable(table, index)}`}
                onClick={() => {
                  onTables(tables.filter((_, i) => i !== index));
                }}
              >
                ×
              </button>
            </div>
            <Columns
              table={table}
              index={index}
              onTable={(changed) => {
                replace(index, changed);
              }}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="schema__add"
        onClick={() => {
          onTables([...tables, { name: "", rows: 1000, columns: [{ name: "", indexed: true }] }]);
        }}
      >
        Add a table
      </button>
    </>
  );
}

interface QueriesProps {
  readonly queries: Query[];
  readonly tables: Table[];
  readonly operations: string[];
  readonly group: string;
  readonly onQueries: (queries: Query[]) => void;
}

/** What each operation asks of the tables. */
function Queries({ queries, tables, operations, group, onQueries }: QueriesProps) {
  const replace = (index: number, query: Query) => {
    onQueries(queries.map((q, i) => (i === index ? query : q)));
  };
  const columnsOf = (name: string): string[] =>
    tables.find((table) => table.name === name)?.columns.map((column) => column.name) ?? [];

  return (
    <>
      <ul className="queries">
        {queries.map((query, index) => (
          <li className="query" key={index}>
            <input
              className="query__operation"
              type="text"
              list={`${group}-ops`}
              aria-label={`Operation query ${String(index + 1)} serves`}
              placeholder="resolve"
              value={query.operation}
              onChange={(event) => {
                replace(index, { ...query, operation: event.target.value });
              }}
            />
            <input
              className="query__table"
              type="text"
              list={`${group}-tables`}
              aria-label={`Table ${callingQuery(query, index)} reads`}
              placeholder="links"
              value={query.table}
              onChange={(event) => {
                replace(index, { ...query, table: event.target.value });
              }}
            />
            <input
              className="query__by"
              type="text"
              list={`${group}-cols-${String(index)}`}
              aria-label={`Column ${callingQuery(query, index)} looks up by`}
              placeholder="code"
              value={query.by}
              onChange={(event) => {
                replace(index, { ...query, by: event.target.value });
              }}
            />
            {/* The columns of whichever table this query names, so the field
                offers the right ones rather than every column in the schema. */}
            {/* Keyed by position rather than by value, like every other list
                here: two columns are blank the moment a second one is added,
                and colliding keys are a console warning that reads as a bug. An
                <option> holds no state, so position is a fine key. */}
            <datalist id={`${group}-cols-${String(index)}`}>
              {columnsOf(query.table).map((column, at) => (
                <option key={at} value={column} />
              ))}
            </datalist>
            <input
              className="query__rows"
              type="number"
              aria-label={`Rows ${callingQuery(query, index)} matches`}
              min={1}
              step={1}
              value={query.rowsMatched}
              onChange={(event) => {
                const rowsMatched = event.target.valueAsNumber;
                if (Number.isFinite(rowsMatched)) {
                  replace(index, { ...query, rowsMatched });
                }
              }}
            />
            <button
              type="button"
              className="query__remove"
              aria-label={`Remove ${callingQuery(query, index)}`}
              onClick={() => {
                onQueries(queries.filter((_, i) => i !== index));
              }}
            >
              ×
            </button>
            {query.operation !== "" && !operations.includes(query.operation) ? (
              <p className="query__unused">
                Nothing in the current load asks for {query.operation}, so this
                query will not be run.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="schema__add"
        onClick={() => {
          onQueries([...queries, { operation: "", table: "", by: "", rowsMatched: 1 }]);
        }}
      >
        Add a query
      </button>
    </>
  );
}

/**
 * What a database holds, and what each operation asks of it.
 *
 * The one decision this exists to make writable is whether the column a query
 * looks rows up by carries an index. Everything else on screen — the row count,
 * which table a query reads — is there because that decision means nothing
 * without them: an index saves you the table, so the size of the table is the
 * size of what it saves.
 *
 * Tables and queries under one fieldset rather than two panels, because a query
 * names a table and a column and neither can be offered without the other in
 * hand. Split apart, someone could rename a column and leave every query that
 * used it pointing at nothing, with no sign until the run was refused.
 */
export function Schema({ tables, queries, operations, onChange }: SchemaProps) {
  const group = useId();
  return (
    <fieldset className="schema">
      <legend className="schema__legend">What it holds</legend>
      <p className="schema__hint">
        A query that can use an index reads the rows it matched. One that cannot
        reads the table. That is the whole of what a schema changes here, and it
        is why the row count matters.
      </p>
      <datalist id={`${group}-ops`}>
        {operations.map((operation) => (
          <option key={operation} value={operation} />
        ))}
      </datalist>
      <datalist id={`${group}-tables`}>
        {tables.map((table, index) => (
          <option key={index} value={table.name} />
        ))}
      </datalist>
      <Tables
        tables={tables}
        onTables={(next) => {
          onChange({ tables: next, queries });
        }}
      />
      <h4 className="schema__subheading">What each operation asks for</h4>
      <Queries
        queries={queries}
        tables={tables}
        operations={operations}
        group={group}
        onQueries={(next) => {
          onChange({ tables, queries: next });
        }}
      />
    </fieldset>
  );
}
