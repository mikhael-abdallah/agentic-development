package model

import "fmt"

// A schema's rules, and what each one is protecting against.
//
// They live here rather than beside DatabaseParams because there are enough of
// them to crowd the parameter it belongs to, and because they are all one
// idea: a query has to be answerable. Every rule below is a way of writing a
// query that names something which is not there — and the failure that follows
// is not a crash, it is a cost silently falling back to the mean and a run
// reporting a database that was never really asked anything.

// validateSchema checks the tables a database declares and the queries that
// read them.
func (p DatabaseParams) validateSchema() error {
	if len(p.Tables) == 0 && len(p.Queries) == 0 {
		return nil
	}
	tables, err := p.validateTables()
	if err != nil {
		return err
	}
	// Required only now. A database with no schema has no rows to convert
	// into time, so demanding a scan rate from every design would be
	// demanding a number for an arithmetic nobody asked for.
	if err := aboveZero("scanPerMillionRowsMs", float64(p.ScanPerMillionRows)); err != nil {
		return err
	}
	if err := representable("scanPerMillionRowsMs", float64(p.ScanPerMillionRows)); err != nil {
		return err
	}
	return p.validateQueries(tables)
}

// validateTables checks each table and returns them by name.
func (p DatabaseParams) validateTables() (map[string]Table, error) {
	if len(p.Tables) == 0 {
		return nil, fmt.Errorf("%w: this database has queries and no tables to run them against",
			ErrParamRange)
	}
	byName := make(map[string]Table, len(p.Tables))
	for _, t := range p.Tables {
		if t.Name == "" {
			return nil, fmt.Errorf("%w: a table has no name", ErrParamRange)
		}
		if _, taken := byName[t.Name]; taken {
			return nil, fmt.Errorf("%w: two tables are called %q", ErrParamRange, t.Name)
		}
		if err := t.validate(); err != nil {
			return nil, err
		}
		byName[t.Name] = t
	}
	return byName, nil
}

func (t Table) validate() error {
	// A table nothing is in cannot be scanned and cannot be read from, and a
	// query against it would cost the same whether it were indexed or not —
	// which is the one thing this whole schema exists to tell apart.
	if err := atLeastInt("rows of "+t.Name, t.Rows, 1); err != nil {
		return err
	}
	if len(t.Columns) == 0 {
		return fmt.Errorf("%w: table %q has no columns, so nothing can be looked up in it",
			ErrParamRange, t.Name)
	}
	seen := make(map[string]bool, len(t.Columns))
	for _, c := range t.Columns {
		if c.Name == "" {
			return fmt.Errorf("%w: a column of %q has no name", ErrParamRange, t.Name)
		}
		if seen[c.Name] {
			return fmt.Errorf("%w: %q has two columns called %q", ErrParamRange, t.Name, c.Name)
		}
		seen[c.Name] = true
	}
	return nil
}

// validateQueries checks that every query names a table and a column that are
// actually there, and asks for a number of rows that table could return.
func (p DatabaseParams) validateQueries(tables map[string]Table) error {
	serving := make(map[string]bool, len(p.Queries))
	for _, q := range p.Queries {
		if q.Operation == "" {
			return fmt.Errorf("%w: a query does not say which operation it serves", ErrParamRange)
		}
		// Two queries for one operation have no answer for what that
		// operation costs, and running the first would be an invention. Same
		// rule as two endpoints serving one operation, for the same reason.
		if serving[q.Operation] {
			return fmt.Errorf("%w: two queries serve %q, so what it costs has no answer",
				ErrParamRange, q.Operation)
		}
		serving[q.Operation] = true
		table, found := tables[q.Table]
		if !found {
			return fmt.Errorf("%w: query for %q reads table %q, which this database does not have",
				ErrParamRange, q.Operation, q.Table)
		}
		if err := q.validateAgainst(table); err != nil {
			return err
		}
		// The rows and the rate are each checked on their own; their product is
		// what the simulation actually holds, and it is the one duration in
		// this model that nothing else looks at. A table large enough times a
		// rate slow enough overflows Millis.Duration() into a negative hold,
		// which folds into a request that finishes before it starts — the
		// silent wrong answer representable() exists to prevent everywhere
		// else. Checked here because this is where both numbers are in hand.
		scan := float64(q.RowsRead(table)) / 1e6 * float64(p.ScanPerMillionRows)
		if err := representable("scan for "+q.Operation, scan); err != nil {
			return err
		}
	}
	return nil
}

func (q Query) validateAgainst(table Table) error {
	if !hasColumn(table, q.By) {
		return fmt.Errorf("%w: query for %q looks up by %q, which %q does not have",
			ErrParamRange, q.Operation, q.By, table.Name)
	}
	if err := atLeastInt("rowsMatched of "+q.Operation, q.RowsMatched, 1); err != nil {
		return err
	}
	// A query cannot match more rows than the table holds. Allowing it would
	// make an indexed lookup cost more than the scan it is supposed to avoid,
	// and the design would report an index as a pessimisation.
	if q.RowsMatched > table.Rows {
		return fmt.Errorf("%w: query for %q matches %d rows of %q, which has %d",
			ErrParamRange, q.Operation, q.RowsMatched, table.Name, table.Rows)
	}
	return nil
}

func hasColumn(table Table, name string) bool {
	for _, c := range table.Columns {
		if c.Name == name {
			return true
		}
	}
	return false
}

// RowsRead is how many rows answering this query actually costs.
//
// The rule the whole schema exists for. An index means the store goes to the
// rows the query matched; without one it reads the table, however large that
// is. On a table of any size that is the difference between a query and an
// outage — and it is a difference no amount of tuning a mean service time can
// express.
func (q Query) RowsRead(table Table) int {
	if table.indexed(q.By) {
		return q.RowsMatched
	}
	return table.Rows
}
