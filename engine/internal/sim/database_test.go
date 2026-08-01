package sim_test

import (
	"errors"
	"testing"

	"github.com/mikhael-abdallah/agentic-development/engine/internal/model"
	"github.com/mikhael-abdallah/agentic-development/engine/internal/sim"
)

// stored is a database behind the cheapest service that can stand in front of
// one: what a database does under load is the subject, and `frontend` is sized
// so that it decides nothing about the answer.
func stored(replicas, pool int, meanRead, meanWrite model.Millis) model.Topology {
	return model.Topology{
		Nodes: []model.Node{
			{ID: "client", Kind: model.KindClient},
			entry(),
			frontend(),
			{ID: "db", Kind: model.KindDatabase, Database: &model.DatabaseParams{
				Replicas:  replicas,
				MeanRead:  meanRead,
				MeanWrite: meanWrite,
				PoolSize:  pool,
			}},
		},
		Edges: []model.Edge{
			{From: "client", To: "in"}, {From: "in", To: "front"}, {From: "front", To: "db"},
		},
	}
}

// What replicas are for. The same read load against a primary alone and
// against a primary with three replicas: four times the connections to serve
// reads with.
func TestReplicasCarryReads(t *testing.T) {
	t.Parallel()
	alone, err := sim.Run(stored(0, 2, 20, 20), reads(150, 31))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	spread, err := sim.Run(stored(3, 2, 20, 20), reads(150, 31))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if spread.Latency.Mean >= alone.Latency.Mean {
		t.Errorf("three replicas gave mean latency %v against %v for the primary alone",
			spread.Latency.Mean, alone.Latency.Mean)
	}
}

// And what they are not for. A write only ever reaches the primary, so adding
// replicas to a write-only design changes nothing whatsoever — not the
// latency, not the drops, not one request's ordering. An identical Result
// rather than a similar one, because there is no mechanism by which a replica
// could touch this run.
//
// This is the failure a design review is supposed to catch and a simulator
// should not hide: replicas bought to fix a write bottleneck.
func TestReplicasDoNothingForWrites(t *testing.T) {
	t.Parallel()
	alone, err := sim.Run(stored(0, 2, 5, 40), writes(40, 32))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	spread, err := sim.Run(stored(6, 2, 5, 40), writes(40, 32))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if !same(spread, alone) {
		t.Errorf("six replicas changed a write-only run:\n got %+v\nwant %+v", spread, alone)
	}
}

// Reads and writes are drawn from their own means. A store where a write
// costs forty times a read has to show it, or the two parameters are one
// parameter with two names.
func TestReadsAndWritesCostTheirOwnTime(t *testing.T) {
	t.Parallel()
	design := stored(0, 8, 1, 40)
	quick, err := sim.Run(design, reads(20, 33))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	slow, err := sim.Run(design, writes(20, 33))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	// Well under the forty-fold ratio of the means, so this is testing that
	// the two draws are separate rather than that a light load is unqueued.
	if slow.Latency.Mean < 10*quick.Latency.Mean {
		t.Errorf("writes averaged %v against reads at %v: the means are not being told apart",
			slow.Latency.Mean, quick.Latency.Mean)
	}
}

// The connection pool is the cap that turns a fast database into a queue —
// the same store, the same work, and the only difference how much of it may
// happen at once.
func TestThePoolIsTheCap(t *testing.T) {
	t.Parallel()
	narrow, err := sim.Run(stored(0, 1, 10, 10), reads(80, 34))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	wide, err := sim.Run(stored(0, 16, 10, 10), reads(80, 34))
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	if wide.Latency.Mean >= narrow.Latency.Mean {
		t.Errorf("sixteen connections gave mean latency %v against one connection's %v",
			wide.Latency.Mean, narrow.Latency.Mean)
	}
}

// A mixed workload is where the two lanes interact: writes queue for the
// primary while reads keep flowing past them to the replicas. The run has to
// stay reproducible through that.
func TestAStoredDesignStillRepeats(t *testing.T) {
	t.Parallel()
	design := stored(2, 3, 4, 30)
	w := load(120, 35)
	w.Operations = asking(0.7)
	first, err := sim.Run(design, w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	for i := range 3 {
		again, err := sim.Run(design, w)
		if err != nil {
			t.Fatalf("Run() unexpected error on repeat %d: %v", i, err)
		}
		if !same(again, first) {
			t.Fatalf("repeat %d differed:\n got %+v\nwant %+v", i, again, first)
		}
	}
}

// Spreading requests over several components is what a load balancer is for.
// Anything else that does it has no rule for choosing, and the engine refuses
// rather than picking one.
//
// The source is a service sending to two databases. It used to be a database
// sending to two services, which the model now refuses earlier and for a
// different reason — a database calls nothing — so the case had to be rebuilt
// out of a pair of kinds that may legally connect.
func TestAComponentSendingToTwoOthersIsRefused(t *testing.T) {
	t.Parallel()
	design := stored(1, 2, 5, 10)
	design.Nodes = append(design.Nodes, model.Node{
		ID: "other", Kind: model.KindDatabase,
		Database: &model.DatabaseParams{Replicas: 0, MeanRead: 5, MeanWrite: 10, PoolSize: 2},
	})
	design.Edges = append(design.Edges, model.Edge{From: "front", To: "other"})
	if _, err := sim.Run(design, load(50, 1)); !errors.Is(err, sim.ErrFanOut) {
		t.Errorf("Run() on a service sending to two components = %v, want ErrFanOut", err)
	}
}

// links is a table of the given size, indexed by code or not.
func links(rows int, indexed bool) model.Table {
	return model.Table{
		Name: "links",
		Rows: rows,
		Columns: []model.Column{
			{Name: "code", Indexed: indexed},
			{Name: "target", Indexed: false},
		},
	}
}

// schemad is `stored` with a schema on its database: one table, one query, and
// a stated cost for reading a million rows.
func schemad(table model.Table, query model.Query, scanPerMillion model.Millis) model.Topology {
	design := stored(0, 8, 1, 1)
	for i := range design.Nodes {
		if design.Nodes[i].Database == nil {
			continue
		}
		design.Nodes[i].Database.Tables = []model.Table{table}
		design.Nodes[i].Database.Queries = []model.Query{query}
		design.Nodes[i].Database.ScanPerMillionRows = scanPerMillion
	}
	return design
}

// The whole reason a schema exists. The same query, the same table, the same
// number of rows returned — and the only difference whether the column it looks
// up by carries an index.
//
// Without one the store reads the table; with one it reads the row. On a table
// of any size that is the difference between a query and an outage, and it is a
// difference no amount of tuning a mean service time can express.
func TestAnIndexIsTheDifferenceBetweenAQueryAndAScan(t *testing.T) {
	t.Parallel()
	query := model.Query{Operation: "read", Table: "links", By: "code", RowsMatched: 1}
	w := load(40, 41)
	w.Operations = asking(1)

	indexed, err := sim.Run(schemad(links(4_000_000, true), query, 20), w)
	if err != nil {
		t.Fatalf("Run() with an index: %v", err)
	}
	scanned, err := sim.Run(schemad(links(4_000_000, false), query, 20), w)
	if err != nil {
		t.Fatalf("Run() without one: %v", err)
	}
	// Four million rows at 20 ms per million is 80 ms of scanning against a
	// 1 ms read, so this is not a close call — and it should not be. A rule
	// that only showed up in the third decimal would not be worth stating.
	if scanned.Latency.Mean < 10*indexed.Latency.Mean {
		t.Errorf("scanning averaged %v against %v for an indexed lookup: the index is "+
			"not deciding how many rows are read", scanned.Latency.Mean, indexed.Latency.Mean)
	}
}

// And the other half of the rule: with an index, the cost follows the rows the
// query matched rather than the size of the table. A table ten times larger
// costs the same to look one row up in.
func TestAnIndexedLookupDoesNotCareHowLargeTheTableIs(t *testing.T) {
	t.Parallel()
	query := model.Query{Operation: "read", Table: "links", By: "code", RowsMatched: 1}
	w := load(40, 42)
	w.Operations = asking(1)

	small, err := sim.Run(schemad(links(1_000_000, true), query, 20), w)
	if err != nil {
		t.Fatalf("Run() on a small table: %v", err)
	}
	large, err := sim.Run(schemad(links(10_000_000, true), query, 20), w)
	if err != nil {
		t.Fatalf("Run() on a large one: %v", err)
	}
	if !same(small, large) {
		t.Error("growing an indexed table changed the run, so the index is not being used")
	}
}

// A schema is an override on the mean, not on the draw. The time is still
// sampled, and sampling consumes one number whatever the mean is — so
// describing a schema cannot shift a draw anywhere else in the run.
//
// A table of a million rows scanned at zero cost per million is the cleanest
// way to say that: the arithmetic runs and adds nothing.
func TestASchemaThatCostsNothingChangesNothing(t *testing.T) {
	t.Parallel()
	w := load(40, 43)
	w.Operations = asking(1)
	plain, err := sim.Run(stored(0, 8, 1, 1), w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	// One row matched on an indexed column, so the rows read are one, and one
	// row at the smallest expressible rate rounds to nothing.
	query := model.Query{Operation: "read", Table: "links", By: "code", RowsMatched: 1}
	described, err := sim.Run(schemad(links(1_000_000, true), query, 1e-6), w)
	if err != nil {
		t.Fatalf("Run() with a schema: %v", err)
	}
	if !same(plain, described) {
		t.Error("describing a schema changed the run, so a query is costing a draw")
	}
}

// A query for traffic this run does not send never fires, the same way an
// endpoint for it does. A schema describes a database more fully than any one
// load exercises it.
func TestAQueryNothingAsksForDoesNothing(t *testing.T) {
	t.Parallel()
	w := load(40, 44)
	w.Operations = asking(1)
	plain, err := sim.Run(stored(0, 8, 1, 1), w)
	if err != nil {
		t.Fatalf("Run() unexpected error: %v", err)
	}
	query := model.Query{Operation: "purge", Table: "links", By: "target", RowsMatched: 900}
	spare, err := sim.Run(schemad(links(1_000_000, false), query, 500), w)
	if err != nil {
		t.Fatalf("Run() with a query nothing asks for: %v", err)
	}
	if !same(plain, spare) {
		t.Error("a query no traffic reaches changed the run")
	}
}
