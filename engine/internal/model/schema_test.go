package model_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
)

// The rule the whole schema exists for, stated on its own rather than inferred
// from a run: an index means the store goes to the rows the query matched, and
// without one it reads the table.
func TestRowsReadIsTheWholeIndexRule(t *testing.T) {
	t.Parallel()
	table := model.Table{
		Name: "links", Rows: 50_000_000,
		Columns: []model.Column{{Name: "code", Indexed: true}, {Name: "target"}},
	}
	tests := []struct {
		name string
		by   string
		want int
	}{
		{"an indexed column reads the rows it matched", "code", 3},
		{"an unindexed one reads the table", "target", 50_000_000},
		// Not a case anyone can reach through Validate, which refuses a query
		// by a column that is not there. Stated because RowsRead is exported
		// and a caller reaching it another way should get the safe answer
		// rather than a silent one-row lookup.
		{"a column that is not there reads the table", "slug", 50_000_000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			q := model.Query{Operation: "resolve", Table: "links", By: tt.by, RowsMatched: 3}
			if got := q.RowsRead(table); got != tt.want {
				t.Errorf("RowsRead by %q = %d, want %d", tt.by, got, tt.want)
			}
		})
	}
}

// The same clock-resolution rule every other duration is held to. A scan rate
// too large to represent would overflow into a run that ends before it starts.
func TestAScanRateLongerThanTheClockIsRefused(t *testing.T) {
	t.Parallel()
	design := stores(model.DatabaseParams{
		MeanRead: 1, MeanWrite: 1, PoolSize: 1,
		Tables:             []model.Table{linkTable()},
		Queries:            []model.Query{{Operation: "resolve", Table: "links", By: "code", RowsMatched: 1}},
		ScanPerMillionRows: model.Millis(1e300),
	})
	if err := design.Validate(); !errors.Is(err, model.ErrParamRange) {
		t.Errorf("Validate() on a scan rate of 1e300 ms = %v, want ErrParamRange", err)
	}
}

// The rows and the rate are each representable and their product is not. It
// takes absurd numbers to reach — a table of 10^17 rows, or a scan measured in
// centuries — but the failure it produces is the worst kind this model has: a
// negative hold time, and a request that finishes before it starts.
func TestAScanTooLongForTheClockIsRefused(t *testing.T) {
	t.Parallel()
	huge := model.Table{
		Name: "links", Rows: 1e18,
		Columns: []model.Column{{Name: "code", Indexed: true}, {Name: "target"}},
	}
	design := stores(model.DatabaseParams{
		MeanRead: 1, MeanWrite: 1, PoolSize: 1,
		Tables: []model.Table{huge},
		// By an unindexed column, so the query reads every one of those rows.
		Queries:            []model.Query{{Operation: "resolve", Table: "links", By: "target", RowsMatched: 1}},
		ScanPerMillionRows: 1_000_000,
	})
	if err := design.Validate(); !errors.Is(err, model.ErrParamRange) {
		t.Errorf("Validate() on a scan of 10^18 rows = %v, want ErrParamRange", err)
	}
	// And the same table read by its index is fine, because it reads one row.
	design = stores(model.DatabaseParams{
		MeanRead: 1, MeanWrite: 1, PoolSize: 1,
		Tables:             []model.Table{huge},
		Queries:            []model.Query{{Operation: "resolve", Table: "links", By: "code", RowsMatched: 1}},
		ScanPerMillionRows: 1_000_000,
	})
	if err := design.Validate(); err != nil {
		t.Errorf("Validate() on an indexed lookup into the same table = %v, want nil", err)
	}
}
